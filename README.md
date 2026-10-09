# Taskspace — Basic Project Management Board

A small full-stack collaboration app with accounts, projects, task cards, member assignment, status updates, and task comments.

## Stack

- Frontend: HTML, CSS, and browser JavaScript
- Backend: Node.js and Express
- Database: SQLite (`projects.db`, created automatically on first run)

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Start the app with `npm start`.
4. Open [http://localhost:3001](http://localhost:3001).

The e-commerce app in `../ecommerce-store` uses port 3000, so both projects can run at the same time.

Set `SESSION_SECRET` to a long random value before use outside local development. The starter uses Express's in-memory session store, so sessions reset when the server restarts. Do not use that session store for a public production deployment.

## Included features

- Register and log in. Passwords are stored as bcrypt hashes.
- Create projects and invite accounts that have already registered.
- Create and assign tasks to project members, choose a priority and optional due date.
- Move task cards across To do, In progress, and Done.
- Delete tasks and leave comments for task conversations.
- Project and task data is stored in SQLite.

This is a basic educational version. Accounts can invite registered users, but there is no email delivery, live WebSocket sync, or production deployment configuration.
