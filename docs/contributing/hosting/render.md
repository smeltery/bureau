# Run Bureau On Render

Render can run Bureau as one Docker web service with a persistent disk. Use
this path when you prefer a managed container host and already have a domain.

You need a paid Render compute plan, a persistent disk, and custom domains for
both the office hostname and wildcard app hostnames. Render's default
`onrender.com` URL cannot provide arbitrary child app names.

## Create The Blueprint

1. In Render, open New > Blueprint.
2. Paste `https://github.com/smeltery/bureau` as the public Git repository and
   keep the `master` branch.
3. Name the Blueprint after the office.
4. Set `BUREAU_PUBLIC_URL` to the final HTTPS office origin, such as
   `https://office.example.com`.
5. Apply and wait for the web service to become Live.

## Configure Domains

Open the web service settings and add both `office.example.com` and
`*.office.example.com` as custom domains. Create the DNS records Render shows
at your registrar and wait for certificates to issue.

## Claim The First Owner

Open the service Environment tab and copy `BUREAU_SETUP_KEY`. Visit the office
URL, enter the setup key and your owner name, and Bureau creates the first
owner. The setup key stops working after an owner exists.

## Persistent Storage

Only the disk mounted at `/var/data` survives deploys. Bureau stores office
state, provider profiles, app credentials, local logs, generated projects, and
checked-out repositories there. Files outside the disk are ephemeral.

See [deploy/render/README.md](../../../deploy/render/README.md) for adapter
details and current validation notes.

