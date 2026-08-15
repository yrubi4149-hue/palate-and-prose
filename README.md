# Palate and Prose

A responsive school-project website for poems and paintings with a real Node.js + SQLite backend.

## What works

- Public Home, About, Poetry and Painting pages
- Responsive layout for phones, tablets and computers
- Admin login
- Only logged-in admin can:
  - Add poems
  - Edit poems
  - Delete poems
  - Upload paintings
  - Delete paintings
- Uploaded painting files are stored on the server
- Poems and paintings are stored in SQLite
- Contact form saves messages to SQLite
- Admin can view contact messages

## Run it

Install Node.js (LTS), then open a terminal in this project folder:

```bash
npm install
npm start
```

Open:

http://localhost:3000

Admin:

http://localhost:3000/login.html

## Admin account

For a school/demo installation, the default account is:

- Username: `admin`
- Password: `ChangeMe123!`

For a real deployment, set environment variables before starting:

```text
ADMIN_USERNAME=your_username
ADMIN_PASSWORD=your_strong_password
SESSION_SECRET=your_long_random_secret
```

Do not publish the default password.

## Important

This is a functional school-project backend. For public internet deployment, use HTTPS, a production session store, backups, stronger account management, and a hosting service that supports Node.js and persistent storage.
