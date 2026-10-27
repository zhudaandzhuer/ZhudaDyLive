/** Original vector artwork. Shared symbols keep per-character geometry small. */
export const colors = [
  "#e8b37b",
  "#8fb9d6",
  "#c493b8",
  "#a9c68b",
  "#d68b87",
  "#c4b0df",
  "#86c5b6",
  "#ddd09c",
];
export const worldArtwork = `<defs>
  <pattern id="grass" width="96" height="96" patternUnits="userSpaceOnUse"><rect width="96" height="96" fill="#66735b"/><path d="m13 29 2-4 2 4m57 39 3-4 2 4m-46 13 2-3 2 3" stroke="#7a886b" fill="none" stroke-width="2"/><circle cx="79" cy="18" r="1" fill="#aeb58a"/></pattern>
  <pattern id="paving" width="90" height="62" patternUnits="userSpaceOnUse"><rect width="90" height="62" fill="#b8ac8e"/><path d="M0 0h90v62H0zM45 0v31M0 31h90m-65 0v31m45-31v31" stroke="#a59a80" fill="none" stroke-width="2"/></pattern>
  <symbol id="fir" viewBox="-35 -72 70 86"><ellipse cy="7" rx="30" ry="10" fill="#1d3228" opacity=".22"/><path d="M-4-25h8v36h-8" fill="#705c47"/><path d="M0-72 20-39h-9l20 34H-30l20-34h-10z" fill="#3d5747"/><path d="M0-72v67h-30l20-34h-10z" fill="#4f6953"/><path d="m0-72-20 33h10L-30-5" fill="none" stroke="#6d8466" stroke-width="2"/></symbol>
  <symbol id="bush" viewBox="-25 -25 50 40"><ellipse cy="10" rx="24" ry="6" fill="#243b2b" opacity=".2"/><path d="M-22 6c-9-17 8-30 18-20 10-18 34-3 25 12 8 15-18 19-24 10C-13 20-24 16-22 6" fill="#526b49"/><circle cx="-9" cy="-2" r="2" fill="#d5b77d"/><circle cx="10" cy="4" r="2" fill="#c89280"/></symbol>
  <symbol id="rock" viewBox="-26 -20 52 40"><ellipse cy="12" rx="24" ry="8" fill="#20342a" opacity=".2"/><path d="m-23 9 6-22 26-5 15 17-5 14-30 3z" fill="#939483"/><path d="m-17-13 26-5 15 17L0-3z" fill="#b4b39d"/><path d="M0-3 9-18M0-3l-11 19" fill="none" stroke="#7b8172" stroke-width="2"/></symbol>
  <symbol id="cottage" viewBox="-82 -95 164 130"><ellipse cy="28" rx="79" ry="18" fill="#263628" opacity=".22"/><path d="M-62-45H62v65H-62" fill="#d8c5a1"/><path d="M-62-45h124v16H-62M-46-45v65m92-65v65M-62 13H62" stroke="#6c5b4a" fill="none" stroke-width="6"/><path d="M-77-41 0-91l77 50z" fill="#915f4d"/><path d="M-77-41 0-91v50z" fill="#ad7761"/><path d="m-64-49 64-41 64 41M-47-59h94m-30-20h-35" stroke="#c29172" fill="none" stroke-width="3"/><path d="M-12 20v-32a12 12 0 0 1 24 0v32" fill="#685444"/><path d="M-45-16h17v15h-17zm73 0h17v15H28z" fill="#525d51"/><path d="M-39-16v15m76-15v15" stroke="#c6b28e" stroke-width="2"/></symbol>
  <symbol id="fighter" viewBox="-29 -55 67 77"><ellipse cy="16" rx="17" ry="6" fill="#152923" opacity=".3"/><g class="legs"><path d="m-7 0-3 15m17-15 4 15" stroke="#403d3b" stroke-width="7" stroke-linecap="round"/></g><path d="m-9-29-10 30 19-8 18 8-9-30z" fill="currentColor"/><path d="M-8-26h16l3 26h-22z" fill="#b4b6af" stroke="#4b5350" stroke-width="1.5"/><path d="M-8-20H8M-9-12H9" stroke="#838d86" stroke-width="2"/><path d="m-11-22-7 17m28-17L18-8" stroke="#ecd1a9" stroke-width="5" stroke-linecap="round"/><g class="weapon"><path d="m17-2 7-41" stroke="#806a4e" stroke-width="3"/><path d="m24-45-6 11 7-3 5 5z" fill="#d8ded5" stroke="#6e7d75" stroke-width="1"/></g><circle cy="-36" r="10" fill="#efd3ad"/><path d="M-10-37a10 10 0 0 1 20 0v3H-10z" fill="#c0c8c1" stroke="#596b64" stroke-width="1.5"/><path d="m-9-42 9-7 9 7M0-47v9" fill="none" stroke="#edf0e0" stroke-width="2"/><path d="M-3-32h6" stroke="#6e6654" stroke-width="1.5"/></symbol>
  <symbol id="flag" viewBox="-8 -45 40 60"><path d="M0-43v55" stroke="#765b42" stroke-width="4"/><path d="M2-42h29L22-29l9 13H2" fill="#c9a06c"/><path d="m8-35 10 6-10 6" fill="none" stroke="#f2dbb0" stroke-width="2"/></symbol>
</defs>
<rect width="2560" height="2560" fill="url(#grass)"/>
<path d="M-20 1450C540 1260 680 1410 1270 1270s830-40 1320-280M1290-20c-170 650 120 850-20 1300s90 800 100 1300" stroke="#9c987b" stroke-width="100" fill="none"/>
<path d="M-20 1450C540 1260 680 1410 1270 1270s830-40 1320-280M1290-20c-170 650 120 850-20 1300s90 800 100 1300" stroke="#b9b191" stroke-width="73" fill="none"/>
<circle cx="1280" cy="1280" r="360" fill="#9b9d7b"/><circle cx="1280" cy="1280" r="296" fill="url(#paving)" stroke="#d4c7a5" stroke-width="12"/>
<circle cx="1280" cy="1280" r="192" fill="none" stroke="#c9b995" stroke-width="3"/><path d="m1280 1170 27 82 86 28-86 27-27 83-27-83-86-27 86-28z" fill="#cabc9a" stroke="#ab9d7e" stroke-width="3"/>
<use href="#flag" x="952" y="1200" width="40" height="60"/><use href="#flag" x="1570" y="1290" width="40" height="60"/>`;

let seed = 91823;
const rand = () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
export const scenery = Array.from({ length: 225 }, (_, i) => {
  const angle = rand() * Math.PI * 2;
  const radius = 890 + rand() * 650;
  const x = 1280 + Math.cos(angle) * radius;
  const y = 1280 + Math.sin(angle) * radius;
  const type =
    i % 17 === 0
      ? "cottage"
      : i % 7 === 0
        ? "rock"
        : i % 4 === 0
          ? "bush"
          : "fir";
  return {
    x,
    y,
    type,
    width: type === "cottage" ? 164 : type === "fir" ? 70 : 50,
    height: type === "cottage" ? 130 : type === "fir" ? 86 : 40,
  };
})
  .filter((p) => p.x > 50 && p.x < 2510 && p.y > 80 && p.y < 2480)
  .sort((a, b) => a.y - b.y);
