# Mijn Muziek — blijvende Google Drive-verbinding (voorbereiding)

## Huidige status
De productie-app op GitHub Pages gebruikt de Google Identity Services **token model**. Een kortlevend toegangstoken bestaat alleen in het geheugen; na refresh is opnieuw klikken op Google verbinden vereist. Alleen de knop automatisch activeren is geen veilige oplossing.

## Voorgestelde architectuur
- Bestaande GitHub Pages-interface en Drive appDataFolder behouden.
- Kleine Cloudflare Worker als OAuth 2.0 authorization-code backend.
- Google OAuth redirect via Worker, scope beperkt tot `drive.appdata`, `access_type=offline` en PKCE/state.
- Client secret en token-encryptiesleutel uitsluitend in Cloudflare Secrets; geen credentials in GitHub of frontend.
- Een beveiligde herroepbare app-sessie; Worker bewaart refresh token versleuteld in een gebonden KV of D1 database.
- Alle Drive-aanvragen via Worker (GET/PATCH/POST). De Worker vernieuwt toegangstokens server-side.
- CORS beperken tot `https://alex2026-cmd.github.io`; geen Google-access- of refresh-tokens naar de browser.
- Bij afmelden sessie intrekken en gegevens verwijderen.
- Eerst aparte testmodus, daarna pas productie aanzetten. De bestaande Google-verbinding moet blijven werken als fallback.

## Vereiste configuratie door eigenaar
1. Cloudflare Free account aanmaken; Workers service + KV/D1 activeren.
2. Worker-URL bekendmaken (zoals `https://mijn-muziek-auth.<subdomain>.workers.dev`).
3. In Google Cloud project *mijn-muziek* een OAuth-webclient toevoegen of de bestaande client uitbreiden met de Worker callback-URL.
4. Client-secret rechtstreeks als Cloudflare Secret invoeren; nooit in chat, GitHub of browser delen.
5. OAuth consent screen: let op dat een app in *Testing* refresh-tokens voor externe gebruikers na circa 7 dagen kan laten verlopen. Voor een blijvende sessie moet de publicatiestatus en verificatie worden nagegaan.

## Acceptatiecriteria
- Eenmalig toestemming geven op MacBook en iPhone.
- Na verversen, sluiten en opnieuw openen: muziek zonder Google-popup synchroniseren.
- Nieuwe nummers en verwijderingen werken in beide richtingen.
- Geen opslag van Google-secret/access/refresh token in localStorage.
- Afmelden blokkeert toekomstige toegang; bestaande muziek blijft lokaal zichtbaar.
- Geen regressie bij handmatige back-up en bestaande opslag.
