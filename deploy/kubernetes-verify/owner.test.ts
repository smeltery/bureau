import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The k3d run deploys owner/kustomization.yaml, so it must be the overlay the
// guide prints, with only the base, the test host and the image digest set.
test("the k3d owner overlay is the guide's overlay", () => {
  const guide = readFileSync(new URL("../../docs/contributing/hosting/kubernetes.md", import.meta.url), "utf8");
  const block = guide.match(/```yaml\n([\s\S]*?)```/)![1];
  const expected = block
    .replace("https://github.com/dotbrains/bureau//deploy/kubernetes?ref=REPLACE_WITH_RELEASE_TAG", "../../kubernetes")
    .replace("REPLACE_WITH_IMAGE_DIGEST", "56feb68ff1eea2ece0a6f0f7e8eaf522ad958021d0672fe6fe74abb69a22889c")
    .replaceAll("office.example.com", "office.k8s.test");
  expect(expected).not.toBe(block);
  expect(readFileSync(new URL("./owner/kustomization.yaml", import.meta.url), "utf8")).toBe(expected);
});

test("the k3d verifier can deploy a local image override", () => {
  const run = readFileSync(new URL("./run.sh", import.meta.url), "utf8");
  expect(run).toContain("IMAGE=${BUREAU_VERIFY_IMAGE:-$RELEASED}");
  expect(run).toContain('docker pull --quiet "$IMAGE"');
  expect(run).toContain('k3d image import --cluster "$CLUSTER" "$IMAGE"');
  expect(run).toContain('kubectl kustomize "$here" | sed "s|$RELEASED|$IMAGE|g" | kubectl apply -f -');
});
