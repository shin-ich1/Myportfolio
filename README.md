# LΛN Portfolio

A personal portfolio showcasing creative design work, practical digital projects, and selected professional experience.

**[View the live portfolio](https://rolando-portfolio-3f1a3.web.app)**

## What you'll find

- **Creative design samples** — product advertising, social media graphics, photo editing, promotional materials, and digital covers.
- **Project case studies** — selected work with descriptions, media galleries, and supporting visuals.
- **Image comparisons** — full before-and-after images displayed together without cropping or permanently merging the originals.
- **Responsive browsing** — layouts designed for desktop, tablet, and mobile visitors.

## Built with

The public experience uses HTML, CSS, and modern JavaScript. Firebase Hosting serves the site; Cloud Firestore manages published content; Cloudinary provides media delivery. A separate Cloudflare Worker supports selected server-side features.

The public portfolio and its administration features are separate. Sensitive operations are handled by server-side services rather than by client-side secrets.

## Viewing locally

Open the repository in VS Code and serve the folder using a static development server such as Live Server. The app uses JavaScript modules, so opening `index.html` directly from the filesystem is not recommended.

Local mode is for preview and development. It is not a replacement for testing real published content in a Firebase Hosting preview channel.

## Development and publishing

- `main` is the canonical repository source.
- Changes are reviewed and tested before release.
- GitHub Actions run tests and source audits; **the checks do not deploy the site**.
- Publishing to Firebase Hosting is a separate, explicitly approved operation.
- `firebase.json` currently retains the existing Hosting configuration to preserve the verified production release. A dedicated publish-directory candidate is prepared separately, not activated by a normal source update.

See [repository maintenance notes](docs/repository-maintenance.md) for secure configuration, preview testing, and analytics verification.

## Media and usage

The images and portfolio examples on this site are presented for demonstration. Please contact the portfolio owner before reusing original designs, photos, or other creative material.
