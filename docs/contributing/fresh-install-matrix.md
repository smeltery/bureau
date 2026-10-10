# Fresh-install verification

The **Fresh install** GitHub Actions workflow runs on application/deployment
changes and can also be dispatched manually. Every case starts with disposable
state and synthetic owner credentials. The native cases use an environment
allowlist; no developer home, provider token or configuration is inherited.
Provider API endpoints point at an unused loopback port, so the signed-out checks
cannot consume paid provider usage.

| Case | Runtime/entrypoint | Checks |
| --- | --- | --- |
| Local Linux and Apple Silicon macOS | Fresh Bun 1.4.2 / Node 24 install; `server/index.ts` | Owner claim and replay rejection, browser identity, real PTY command, Claude/Codex sign-in guidance, readiness |
| Private Tailscale, Funnel, own domain, VPS | Same server, each with its own configured public origin; restart after Access changes | Same checks after persisted origin/rebind configuration |
| Render | Image built from the checkout's `deploy/render/Dockerfile`, real shell/Python/Bun entrypoints | Setup-key and foreign-origin rejection, owner claim and replay rejection, then the common checks |
| Kubernetes | Disposable k3d cluster, checkout image, overlay of the production manifests | Installed seccomp profile, non-root identity, dropped capabilities, setup and common checks, healthy rollout |

The remote-origin cases certify Bureau's application configuration and origin
handling. They do **not** provision a real tailnet, Funnel endpoint, public DNS,
TLS certificate or paid VPS. Render runs locally as its deployment image, not as
a paid Render service. Kubernetes uses disposable `emptyDir` storage and smaller
resource requests; the production security context and seccomp installer remain
intact. It does not certify EKS/ALB/EBS behavior or persistent storage recovery.
The separate `deploy/kubernetes-verify` suite covers the fuller CSI/ingress setup.
These boundaries are deliberate and should stay explicit in release claims.

## Run locally

Install dependencies and build the UI first:

```sh
flox activate -- bun install --frozen-lockfile
flox activate -- bun run build:ui
flox activate -- bun deploy/install-verify/local.ts local
flox activate -- bun deploy/install-verify/local.ts private
flox activate -- bun deploy/install-verify/local.ts funnel
flox activate -- bun deploy/install-verify/local.ts domain
flox activate -- bun deploy/install-verify/local.ts vps
```

The native checks also run with the documented manual Bun/Node installation.
For deployment images and Kubernetes, Docker is required; Kubernetes additionally
needs k3d 5.9.0, kubectl and OpenSSL:

```sh
docker build -f deploy/render/Dockerfile -t bureau-install:verify .
flox activate -- bun deploy/install-verify/container.ts
flox activate -- bash deploy/install-verify/kubernetes.sh
```

Each native run removes its temporary home and stops its server. Container runs
remove only their uniquely named container. Kubernetes runs use a unique cluster
and private kubeconfig, then delete both without changing the operator's current
kubectl context. A failed case exits nonzero and prints diagnostics.

## Installation repairs covered

Flox now includes Node 24 for the terminal sidecar instead of relying on a host
Node installation. The root postinstall repairs a missing executable bit on
node-pty's packaged macOS spawn helper. A focused test covers that repair, and the
macOS matrix requires actual terminal output so a merely successful build cannot
hide another native-addon startup regression.
