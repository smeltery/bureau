# Set up Bureau on Kubernetes (EKS)

This guide runs a Bureau office in an Amazon EKS cluster from the published
container image. You will open it at a web address such as
`https://office.example.com`.

The office is one pod with one persistent disk. It runs one replica only.

## Before you start

You need:

- An EKS cluster on Kubernetes 1.29 or later, with IPv4 addressing.
- A node group of **Amazon Linux 2023, x86_64 or arm64** nodes, each with at
  least **2 CPUs and 8 GiB of memory**. The image is published for amd64 and
  arm64.
  - Add the Kubernetes label `bureau.com/office-node=true` to these nodes.
    The office and its seccomp installer run only on labeled nodes.
  - In the launch template (or Karpenter `EC2NodeClass`), set instance
    metadata to **IMDSv2 required** with **hop limit 1**. Agents run commands
    in the office pod; this setting keeps them from the node's AWS role.
- The **Amazon EBS CSI driver** add-on.
- The **AWS Load Balancer Controller**.
- An **ACM certificate** that covers both `office.example.com` and
  `*.office.example.com`. Apps that agents build get their own addresses under
  the office address, such as `notes.office.example.com`.
- `kubectl` with Git available, configured for the cluster.

Fargate cannot run the office: it has no EBS volumes and no custom seccomp
profiles.

## 1. Create the setup key

The setup key lets you claim the office as its first owner. It must have at
least 32 characters.

```sh
kubectl create namespace bureau
kubectl -n bureau create secret generic bureau-setup \
  --from-literal=BUREAU_SETUP_KEY="$(openssl rand -hex 32)"
```

You can also create the Secret `bureau-setup` with key `BUREAU_SETUP_KEY`
from your own secret manager.

## 2. Write your deployment settings

On the [Bureau container images page](https://github.com/dotbrains/bureau/pkgs/container/bureau),
choose a release tag, which starts with `v`, and copy its image digest
(`sha256:…`). You can also read the digest with
`docker buildx imagetools inspect ghcr.io/dotbrains/bureau:REPLACE_WITH_RELEASE_TAG`.

Create a directory for your office and save this file in it as
`kustomization.yaml`. Replace the release tag, the digest, the certificate ARN,
and `office.example.com` in all four places.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - https://github.com/dotbrains/bureau//deploy/kubernetes?ref=REPLACE_WITH_RELEASE_TAG
images:
  - name: ghcr.io/dotbrains/bureau
    digest: sha256:REPLACE_WITH_IMAGE_DIGEST
configMapGenerator:
  - name: bureau-config
    namespace: bureau
    behavior: replace
    literals:
      - BUREAU_PUBLIC_URL=https://office.example.com
patches:
  - target:
      kind: Ingress
      name: bureau
    patch: |-
      - op: replace
        path: /spec/rules/0/host
        value: office.example.com
      - op: replace
        path: /spec/rules/1/host
        value: "*.office.example.com"
      - op: replace
        path: /metadata/annotations/alb.ingress.kubernetes.io~1certificate-arn
        value: arn:aws:acm:REGION:ACCOUNT:certificate/REPLACE_WITH_CERTIFICATE_ID
```

Use the same release tag for the manifests and the image. The
[reference manifests](https://github.com/dotbrains/bureau/tree/master/deploy/kubernetes)
create:

- A 30 GiB encrypted gp3 volume that is kept when you delete the claim.
- One office pod that runs as a non-root user with no added privileges, under
  the `restricted` Pod Security Standard.
- An internet-facing Application Load Balancer. For an office reachable only
  from your network, patch `alb.ingress.kubernetes.io/scheme` to `internal`.
- A network policy that blocks the instance metadata address. It works only
  when the VPC CNI enforces network policies; the node setting above is the
  required protection. To also keep agents out of your VPC, add its private
  ranges to that policy.
- A DaemonSet that writes the office's seccomp profile to each labeled node.
  The browser in the office needs this profile for its sandbox. If your
  cluster does not allow `hostPath` volumes, write the file from node user
  data instead, to
  `/var/lib/kubelet/seccomp/bureau/bureau-chromium-v1.json`, and remove the
  DaemonSet with a patch.

## 3. Start the office

From the directory with your `kustomization.yaml`:

```sh
kubectl apply -k .
kubectl -n bureau rollout status deployment/bureau --timeout=10m
```

If the pod shows `CreateContainerError`, the seccomp profile is not yet on its
node. It starts when the installer has written the file:

```sh
kubectl -n bureau-node-setup get pods -o wide
```

## 4. Point your domain at the office

Find the load balancer's address:

```sh
kubectl -n bureau get ingress bureau
```

In your DNS, point both `office.example.com` and `*.office.example.com` to
that address. In Route 53, use alias records to the load balancer.

## 5. Claim the office

Display the setup key:

```sh
kubectl -n bureau get secret bureau-setup \
  -o jsonpath='{.data.BUREAU_SETUP_KEY}' | base64 -d; echo
```

Open your office address in a browser. On **Set up your office**, paste the key
into **Setup key**, enter your name, and select **Create office**.

The key cannot claim the office again after an owner exists. To remove it:

```sh
kubectl -n bureau delete secret bureau-setup
kubectl -n bureau rollout restart deployment/bureau
```

<!-- include: provider -->

<!-- include: invites -->

## Update the office

The office's Updates pane shows when a new release is out and links here; it
has no Update now button on Kubernetes. Releases are on the
[Bureau container images page](https://github.com/dotbrains/bureau/pkgs/container/bureau)
and in the [release notes](https://github.com/dotbrains/bureau/releases).

1. Finish active agent work. The update restarts the office and its apps.
2. Take a snapshot of the office's EBS volume. An update can change stored
   data, so going back to an older image needs this snapshot.
3. In your `kustomization.yaml`, change the release tag and the image digest
   to the new release.
4. Apply it:

   ```sh
   kubectl apply -k .
   kubectl -n bureau rollout status deployment/bureau --timeout=10m
   ```

The old pod stops before the new pod starts, so the office is unavailable for
about a minute.

Never force-delete the office pod or force-detach its volume while its old node
may still run. The volume must have only one writer.

<!-- include: backup -->

Keep separate snapshots of the complete EBS volume for recovery from disk loss,
for example with AWS Backup.

## Office logs

```sh
kubectl -n bureau logs deployment/bureau
kubectl -n bureau exec deployment/bureau -- \
  tail -n 50 /var/data/home/.bureau/container-runtime/office.log
```

Only `/var/data` survives a pod replacement. Keep projects and dependency
installs under `/var/data/home` or `/var/data/workspaces`. See the
[container reference](https://github.com/dotbrains/bureau/blob/master/deploy/container/reference.md)
for runtime details.
