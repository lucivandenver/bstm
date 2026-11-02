# Public landing and authentication layout correction

Branch: `fix/public-landing-auth-mobile`. Base: main `a5ebf7216ddf65f418c994649ea5feb0bbfa6467`.

- Restore the original landing layout and headline/copy from `39f5ab6`, including the three original campus carousel images. Counters remain real database counts, and the static demonstration cards are labelled as an illustrative preview.
- Share one public header between Home and About. Keep all three institutional logos visible on mobile, enlarge the CareerBridge wordmark, and place Log In/Sign Up inside the hamburger menu below 1100px. Desktop keeps its navigation and authentication controls.
- Share the login/register dialogs between Home and About. Bound their height to the visual viewport, scroll inside the card, start at the heading and retain a visible sticky close action. Native mobile select controls and focus trapping remain usable.
- `/login` and `/register` now render the landing with the requested dialog, not the separate templates with a Back to Home header. The client normalises the URL to the landing auth state. Close, Escape, backdrop and browser Back return to the landing. Closing an incomplete Google registration clears its pending identity.
- Preserve Student/Faculty selection, Student ID/Faculty ID rules, Student gender, verified Google registration completion, CSRF validation and login/registration error notices. Authentication pages are not cached.
- This change does not alter Student/Faculty/Admin learning records or the database schema. No new migration, secrets or hosting environment variables are required for this UI correction.

Validation: all **29 automated tests** pass. Browser QA covers 320×568, 390×844, 768×1024, 1280×720, 1440×900 and 1366×500, checking logo visibility, hamburger auth controls, card boundaries, sticky close after scrolling, role selection, visible login errors, all exit routes and absence of horizontal overflow. No browser page errors were observed. Original image assets are unchanged.

Changed source: `controllers/authController.js`, `index.js`, `routes/index.js`, `views/home.xian`, `views/about.xian`, `views/partials/head.xian`, new `publicHeader.xian`/`publicAuthDialogs.xian` partials, `public/css/public-ui.css`, `public/js/public-ui.js`, rebuilt `public/tailwind.css`, and authentication regression tests.

The generated image preview accompanying this request is a visual illustration only; the application uses the original logo files and actual HTML/CSS, not a screenshot replacement.
