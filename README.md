# has-a.tech website

The site at [has-a.tech](https://has-a.tech): the guide, the claim helper, and student verification. It runs on Cloudflare Workers.

Names themselves are registered in [has-a-tech/register](https://github.com/has-a-tech/register).

## What's here

- `public/`: the pages (plain HTML, CSS and JavaScript, no build step)
- `src/index.js`: the API: GitHub sign-in, school email codes, and the status lookup the register bot uses
- `src/schools.js`: which email domains count as schools
- `test/`: end-to-end tests with fake GitHub, email and storage (`npm test`)

## Add a school

Open `src/schools.js`, add the domain to `SCHOOL_DOMAINS` (alphabetical order), and open a pull request. Only add domains that give addresses to students or staff of that school. Subdomains are covered automatically, so `utoronto.ca` also covers `mail.utoronto.ca`.

## Privacy

The service stores no email addresses. See [the privacy page](https://has-a.tech/privacy) and `src/index.js` for exactly what's kept.

Maintainers: see [SETUP.md](./SETUP.md).
