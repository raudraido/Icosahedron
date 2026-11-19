# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository. Say which product and version, and how to reproduce it.

You will get an answer as soon as the maintainer can; this is a one-person project, so please allow some days.

## What is supported

Only the **latest stable release** of each product gets fixes. Update the server first, then the apps ([docs/compatibility.md](docs/compatibility.md)).

## Where security matters most

The web engine can be the only thing you put on the internet in front of Navidrome. Its sign-in design (device secrets, approval from an already trusted device, recovery codes) is described in [docs/secure-sign-in.md](docs/secure-sign-in.md); reports about it are especially welcome.
