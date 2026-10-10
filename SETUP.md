# Setting up the has-a.tech website

One-time setup, in order. It takes about 45 minutes. You'll create four things: an email-sending account, a GitHub sign-in app, a storage space on Cloudflare, and a few secret keys.

> **Never commit a secret to this repo.** Secrets go into Cloudflare (`npx wrangler secret put`) or GitHub (Settings → Secrets). If one leaks, revoke it and make a new one.

## 1. Email sending (Resend)

1. Sign up at [resend.com](https://resend.com).
2. **Domains → Add domain →** `has-a.tech`.
3. Resend shows DNS records to add. In the Cloudflare dashboard (**has-a.tech → DNS → Records**), add each one exactly as shown. They're usually:
   - a TXT record at `resend._domainkey`
   - an MX record and a TXT record at `send`
   
   The register's DNS automation is set to leave `send` and `*._domainkey` alone, so these won't be deleted.
4. Wait until Resend shows the domain as **Verified**.
5. **API Keys → Create API key**, with **Sending access** for `has-a.tech` only. Copy it for step 4.

## 2. A second email address for manual checks

In Cloudflare **Email Routing → Routing rules**, add `verify@has-a.tech` → your inbox, the same way you made `abuse@has-a.tech`. Students without a school email write to this address.

## 3. GitHub sign-in app

1. Go to **github.com/organizations/has-a-tech/settings/applications** (org **Settings → Developer settings → OAuth Apps**) → **New OAuth App**.
2. Fill in:
   - Application name: `has-a.tech`
   - Homepage URL: `https://has-a.tech`
   - Authorization callback URL: `https://has-a.tech/api/auth/callback`
3. Click **Register application**. Copy the **Client ID**.
4. Click **Generate a new client secret** and copy it for step 4.

## 4. Cloudflare Worker

In Terminal, inside this folder:

```sh
npm install
npx wrangler login
npx wrangler kv namespace create VERIFY
```

The last command prints an `id`. Open `wrangler.jsonc` and replace:
- `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` with that id
- `REPLACE_WITH_GITHUB_CLIENT_ID` with the Client ID from step 3

Now add the secrets. Each command asks you to paste a value:

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET   # from step 3
npx wrangler secret put RESEND_API_KEY         # from step 1
npx wrangler secret put SESSION_SECRET         # a new random value (see below)
npx wrangler secret put HMAC_SECRET            # a new random value
npx wrangler secret put STATUS_API_KEY         # a new random value; you'll need it again in step 6
```

Make each random value with:

```sh
openssl rand -base64 32
```

Use a different one for each secret. Save `STATUS_API_KEY` in your password manager. **Never change `HMAC_SECRET` after launch**: it would unlink every verified email.

## 5. Deploy

```sh
npx wrangler deploy
```

This publishes the site and connects it to `has-a.tech` and `www.has-a.tech`. Open https://has-a.tech and try the whole flow yourself: sign in, verify with your school email, and check the claim page shows you as verified.

### Automatic deploys (optional)

So every push to `main` deploys by itself:

1. In Cloudflare, create an API token from the **Edit Cloudflare Workers** template. Limit it to your account and the `has-a.tech` zone.
2. Copy your **Account ID** (Cloudflare dashboard → Workers & Pages → right-hand side).
3. In this repo on GitHub: **Settings → Secrets and variables → Actions**, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

The workflow runs the tests first and only deploys if they pass.

## 6. Connect the register bot

In the **register** repo on GitHub: **Settings → Secrets and variables → Actions → New repository secret**:

- Name: `VERIFY_API_KEY`
- Value: the same `STATUS_API_KEY` from step 4

From now on, the bot only accepts new names from verified students.

---

## Verifying a student by hand

When a student emails `verify@has-a.tech` without a school email:

1. Check their proof. Make sure the GitHub username is theirs: ask them to reply from a comment on a GitHub issue, or to put a word you choose in their GitHub profile bio for a few minutes.
2. **Delete their email and any attachments** once you've decided.
3. Mark them verified (lowercase username):

```sh
npx wrangler kv key put --binding VERIFY --remote "verified:their-username" '{"verifiedAt":"2026-10-10T00:00:00Z","method":"manual","schoolDomain":"Example Secondary School"}'
```

To remove someone's verification:

```sh
npx wrangler kv key delete --binding VERIFY --remote "verified:their-username"
```

## Adding a school

When someone opens an "Add my school" issue, check the domain really belongs to that school (its website, or its IT help pages), then add it to `src/schools.js`, run `npm test`, and push.

## Free-plan limits to watch

At the time of writing:
- **Resend free:** about 100 emails a day.
- **Cloudflare KV free:** 1,000 writes a day. Each verification uses about 6 writes, so roughly 150 verifications a day.
- **Workers free:** 100,000 requests a day.

Check each provider's current limits. If you get close, the paid tiers are inexpensive, or you can apply for sponsorships.

## Privacy and minors

Many users are under 18. Keep it simple: collect nothing extra, delete manual-verification messages right away, and respond quickly to deletion requests. Privacy law varies by province and country (for example, Quebec has extra rules for people under 14). Before the service grows, it's worth having someone with privacy-law knowledge review the [privacy page](./public/privacy.html).

## Running it locally

Create a second GitHub OAuth app with the callback `http://localhost:8787/api/auth/callback`, then create `.dev.vars` (it's in `.gitignore`):

```
SITE_URL=http://localhost:8787
EMAIL_DEV_LOG=true
GITHUB_CLIENT_ID=your-dev-client-id
GITHUB_CLIENT_SECRET=your-dev-client-secret
SESSION_SECRET=anything
HMAC_SECRET=anything
STATUS_API_KEY=anything
```

Run `npm run dev`. With `EMAIL_DEV_LOG=true`, codes are printed in the terminal instead of emailed. That only works on localhost.
