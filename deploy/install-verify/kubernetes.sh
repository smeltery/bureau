#!/usr/bin/env bash
set -euo pipefail
umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/bureau-install-k8s.XXXXXX")
cluster="bureau-install-$RANDOM-$RANDOM"
k3d_bin=${K3D_BIN:-k3d}
export KUBECONFIG="$work/kubeconfig"
forward_pid=
cleanup() {
  if [[ -n "$forward_pid" ]]; then kill "$forward_pid" 2>/dev/null || true; wait "$forward_pid" 2>/dev/null || true; fi
  "$k3d_bin" cluster delete "$cluster" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
"$k3d_bin" cluster create "$cluster" --image rancher/k3s:v1.33.13-k3s2@sha256:ada5ff2e138120efe877f76d514dedda65b304122112b982eab532732c028c89 \
  --agents 0 --servers-memory 4g --k3s-node-label 'bureau.com/office-node=true@server:0' \
  --kubeconfig-update-default=false --kubeconfig-switch-context=false --wait
"$k3d_bin" kubeconfig get "$cluster" > "$KUBECONFIG"
"$k3d_bin" image import --cluster "$cluster" bureau-install:verify
kubectl create namespace bureau
key="synthetic-$(openssl rand -hex 16)"
kubectl -n bureau create secret generic bureau-setup --from-literal="BUREAU_SETUP_KEY=$key"
kubectl apply -k deploy/install-verify/kubernetes
kubectl -n bureau-node-setup rollout status daemonset/bureau-seccomp-installer --timeout=180s
kubectl -n bureau wait --for=jsonpath='{.status.phase}'=Running pod -l app.kubernetes.io/name=bureau --timeout=180s
kubectl -n bureau port-forward --address=127.0.0.1 deployment/bureau :10000 > "$work/forward.log" 2>&1 &
forward_pid=$!
for _ in $(seq 1 100); do
  if grep -q 'Forwarding from 127.0.0.1:' "$work/forward.log"; then break; fi
  if ! kill -0 "$forward_pid" 2>/dev/null; then cat "$work/forward.log"; exit 1; fi
  sleep 0.1
done
port=$(sed -n 's/.*127\.0\.0\.1:\([0-9]*\).*/\1/p' "$work/forward.log" | head -n 1)
if [[ -z "$port" ]]; then cat "$work/forward.log"; exit 1; fi
if ! BUREAU_VERIFY_URL="http://127.0.0.1:$port" BUREAU_VERIFY_SETUP_KEY="$key" bun deploy/install-verify/remote.ts; then
  kubectl -n bureau logs deployment/bureau --tail=100
  exit 1
fi
kubectl -n bureau rollout status deployment/bureau --timeout=90s
