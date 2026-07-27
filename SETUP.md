# Rolando Portfolio — Setup, No-Code Updates, GitHub, and Free Publishing

## Open it on your computer

Because this version is a static website, no package installation is required.

Recommended method:

1. Open the project folder in VS Code.
2. Install the free **Live Server** extension.
3. Right-click `index.html` and choose **Open with Live Server**.

You can also run:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`.

## Publish free on GitHub Pages

1. Create a new public repository, for example `rolando-portfolio`.
2. Upload all files and folders from this project.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Choose branch **main** and folder **/(root)**.
6. Save. GitHub will provide your free website address.

Command-line upload:

```bash
git init
git add .
git commit -m "Build personal portfolio"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/rolando-portfolio.git
git push -u origin main
```

## Update it online without coding

The portfolio includes an administrator page at:

```text
https://your-site-address/#admin
```

To make the admin save public changes, connect a free Firebase project:

1. Create a project at Firebase Console.
2. Add a **Web App**.
3. Enable **Authentication → Email/Password**.
4. Add your administrator email and password under Authentication → Users.
5. Create a **Cloud Firestore** database.
6. Open `config.js` and paste the Firebase Web App configuration.
7. Install Firebase CLI only once:

```bash
npm install -g firebase-tools
firebase login
firebase init firestore
```

Use the included `firestore.rules`, then deploy:

```bash
firebase deploy --only firestore:rules
```

After that, open `#admin`, sign in, edit the portfolio content, and click **Save Changes**. The public website reads the latest information from Firestore automatically. You do not need to edit HTML, CSS, or JavaScript for normal content updates.

## Add a new project from the admin page

Inside the `projects` list:

1. Copy one complete project object, including its opening and closing braces.
2. Paste it after another project, separated by a comma.
3. Change the title, description, image, tags, and link.
4. Click **Save Changes**.

## Important items to replace later

- Replace `#` in the LinkedIn and Facebook fields with your real profile links.
- Replace generated photo-editing practice samples with your strongest final work.
- Add certificate scans when they are ready.
- Keep `config.js` in the project; Firebase Web App configuration is designed for browser use. Security comes from Authentication and Firestore rules.
