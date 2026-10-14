// eslint-disable-next-line import/no-unassigned-import -- X.509 decorators require the reflection polyfill before module initialization.
import "reflect-metadata";
import { BasicConstraintsExtension, ExtendedKeyUsageExtension, KeyUsageFlags, KeyUsagesExtension, SubjectAlternativeNameExtension, X509Certificate, X509CertificateGenerator } from "@peculiar/x509";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, webcrypto } from "node:crypto";
import { rootCertificates } from "node:tls";
import { validSecretHost } from "../../../shared/integrations/connections.ts";

const algorithm = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const cryptoProvider = webcrypto as unknown as Crypto;
function pem(label: string, data: ArrayBuffer): string {
  return `-----BEGIN ${label}-----\n${Buffer.from(data)
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n")}\n-----END ${label}-----\n`;
}
export async function createProxyMaterial(root: string) {
  const directory = join(root, "credential-proxy");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const identityPath = join(directory, "identity.json");
  let identity: { privateKey: string; certificate: string; placeholderKey: string };
  if (existsSync(identityPath)) {
    identity = JSON.parse(readFileSync(identityPath, "utf8"));
    if (typeof identity.privateKey !== "string" || typeof identity.certificate !== "string" || !/^[a-f0-9]{64}$/.test(identity.placeholderKey))
      throw new Error("Credential proxy identity is unreadable.");
  } else {
    const keys = await cryptoProvider.subtle.generateKey(algorithm, true, ["sign", "verify"]);
    const certificate = await X509CertificateGenerator.createSelfSigned(
      {
        name: "CN=Bureau credential proxy",
        keys,
        signingAlgorithm: algorithm,
        notBefore: new Date(Date.now() - 86400000),
        notAfter: new Date(Date.now() + 10 * 365 * 86400000),
        extensions: [new BasicConstraintsExtension(true, 0, true), new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true)],
      },
      cryptoProvider,
    );
    identity = {
      privateKey: Buffer.from(await cryptoProvider.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64"),
      certificate: certificate.toString("pem"),
      placeholderKey: randomBytes(32).toString("hex"),
    };
    const temporary = `${identityPath}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
      renameSync(temporary, identityPath);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  chmodSync(identityPath, 0o600);
  const authority = new X509Certificate(identity.certificate);
  if (authority.notAfter.getTime() <= Date.now()) throw new Error("Credential proxy certificate expired.");
  const signingKey = await cryptoProvider.subtle.importKey("pkcs8", Buffer.from(identity.privateKey, "base64"), algorithm, false, ["sign"]);
  const trustPath = join(directory, "trust.pem");
  const roots = [...rootCertificates];
  for (const path of [process.env.SSL_CERT_FILE, process.env.NODE_EXTRA_CA_CERTS]) {
    if (path && path !== trustPath && existsSync(path)) roots.push(readFileSync(path, "utf8"));
  }
  writeFileSync(trustPath, [...roots, identity.certificate].join("\n"), { mode: 0o600 });
  chmodSync(trustPath, 0o600);
  return {
    trustPath,
    ca: identity.certificate,
    placeholderKey: Buffer.from(identity.placeholderKey, "hex"),
    async certificate(host: string) {
      if (!validSecretHost(host)) throw new Error("Credential proxy host is not permitted.");
      const keys = await cryptoProvider.subtle.generateKey(algorithm, true, ["sign", "verify"]);
      const certificate = await X509CertificateGenerator.create(
        {
          subject: `CN=${host}`,
          issuer: authority.subject,
          publicKey: keys.publicKey,
          signingKey,
          signingAlgorithm: algorithm,
          notBefore: new Date(Date.now() - 86400000),
          notAfter: new Date(Math.min(authority.notAfter.getTime(), Date.now() + 30 * 86400000)),
          extensions: [
            new BasicConstraintsExtension(false, undefined, true),
            new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
            new ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.1"]),
            new SubjectAlternativeNameExtension([{ type: "dns", value: host }]),
          ],
        },
        cryptoProvider,
      );
      return { cert: certificate.toString("pem"), key: pem("PRIVATE KEY", await cryptoProvider.subtle.exportKey("pkcs8", keys.privateKey)) };
    },
  };
}
export type ProxyMaterial = Awaited<ReturnType<typeof createProxyMaterial>>;
