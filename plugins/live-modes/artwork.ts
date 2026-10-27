// Original vector artwork. The small mechanical parts remain separate so the
// needle, flywheel, spool and fabric can move without blurring the metalwork.
export const machineArtwork = `<svg class="machine" viewBox="0 0 900 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="复古缝纫机">
<defs>
 <linearGradient id="enamel" x2=".35" y2="1"><stop stop-color="#53575c"/><stop offset=".15" stop-color="#10171d"/><stop offset=".48" stop-color="#242a30"/><stop offset=".54" stop-color="#070d12"/><stop offset="1" stop-color="#171d24"/></linearGradient>
 <linearGradient id="gold" x2=".2" y2="1"><stop stop-color="#fff1bc"/><stop offset=".22" stop-color="#c39343"/><stop offset=".48" stop-color="#ffdfa0"/><stop offset=".73" stop-color="#936324"/><stop offset="1" stop-color="#edc77a"/></linearGradient>
 <linearGradient id="steel" x2="1" y2=".15"><stop stop-color="#2c3540"/><stop offset=".18" stop-color="#c9d1db"/><stop offset=".3" stop-color="#f2f5f9"/><stop offset=".49" stop-color="#657180"/><stop offset=".65" stop-color="#d8dfe6"/><stop offset="1" stop-color="#3b4552"/></linearGradient>
 <linearGradient id="cloth" x2=".7" y2="1"><stop stop-color="#b8c4d2"/><stop offset=".45" stop-color="#475a70"/><stop offset="1" stop-color="#8d9db0"/></linearGradient>
 <linearGradient id="order-cloth" x2=".25" y2="1"><stop stop-color="var(--cloth-light)"/><stop offset=".4" stop-color="var(--cloth-mid)"/><stop offset=".7" stop-color="var(--cloth-dark)"/><stop offset="1" stop-color="var(--cloth-mid)"/></linearGradient>
 <linearGradient id="roll-end"><stop stop-color="var(--cloth-light)"/><stop offset="1" stop-color="var(--cloth-dark)"/></linearGradient>
 <radialGradient id="wheel"><stop stop-color="#86919c"/><stop offset=".5" stop-color="#151b23"/><stop offset=".77" stop-color="#606c76"/><stop offset=".9" stop-color="#d7dfe4"/><stop offset="1" stop-color="#121921"/></radialGradient>
 <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="12" stdDeviation="10" flood-opacity=".5"/></filter>
 <pattern id="weave" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 1h7M1 0v7" stroke="#fff" stroke-opacity=".11" stroke-width=".6"/></pattern>
 <clipPath id="feed-clip"><path d="M798 427Q636 419 440 438L215 444Q160 448 88 490l18 27q77-46 126-49l215-3q191-20 355-10Z"/></clipPath>
 <g id="flower" fill="none" stroke="url(#gold)" stroke-width="2.2"><path d="M0 0C-34-20-29-42-12-30C-12-55 13-55 12-30C31-43 35-19 0 0C28-18 42 1 23 9C41 23 21 39 5 13C10 43-15 43-11 17C-38 40-47 16-21 9C-51-3-31-25 0 0Z"/><circle r="6" fill="url(#gold)"/><path d="M0 4C-20 26-31 32-51 28M-22 24q-9-19-22-11M-33 29q-12 13-23 5M0 5q19 18 36 9"/></g>
 <g id="screw"><circle r="5" fill="url(#steel)"/><path d="M-3 1l6-2" stroke="#121922" stroke-width="2"/></g>
</defs>
<ellipse cx="460" cy="607" rx="368" ry="18" fill="#050910" opacity=".32"/>
<g filter="url(#shadow)">
 <path d="M105 548h680l-23 49H125Z" fill="url(#enamel)" stroke="url(#gold)" stroke-width="4"/>
 <rect x="94" y="541" width="700" height="17" rx="7" fill="url(#gold)"/>
 <path d="M144 578h590M160 588h559" stroke="url(#gold)" opacity=".55"/>
 <path d="M158 537q-33-4-30-24l5-29q2-13 24-13h536q27 2 28 18l1 28q0 15-28 20Z" fill="url(#enamel)" stroke="url(#gold)" stroke-width="3"/>
 <path d="M156 480h531M158 528h529" stroke="url(#gold)" stroke-width="1.8"/>
 <path d="M203 464h473v9H203Z" fill="url(#steel)"/>
 <g class="material-system">
  <g class="finished-fabric" aria-label="已完成布料">${[0, 1, 2, 3].map((i) => `<g class="finished-fold" data-fold="${i}" transform="translate(0 ${-i * 12})"><path d="M60 477q49-11 101 1l14 13q-63 11-125 0Z" fill="url(#order-cloth)" stroke="var(--cloth-light)" stroke-width="1.5"/><path d="M59 486q50 9 104 0" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 4"/></g>`).join("")}</g>
  <g class="fabric" clip-path="url(#feed-clip)"><rect x="60" y="418" width="770" height="115" fill="url(#order-cloth)"/><rect class="fabric-texture" x="20" y="415" width="850" height="120" fill="url(#weave)"/><path d="M798 432Q636 424 440 444L215 450Q160 454 88 496" fill="none" stroke="var(--cloth-light)" stroke-width="2"/><path class="fabric-stitches" d="M215 450Q160 454 88 496" fill="none" stroke="var(--accent)" stroke-width="3" stroke-dasharray="5 4"/></g>
 </g>
 <path d="M579 454q7-84-2-157q-3-25-34-25H288q-27 0-29 25l-3 59h-65l-8-94q-4-67 53-85q23-8 63 6q130 50 269-1q63-25 88 17q17 23 8 69l-18 116q-9 45 24 70Z" fill="url(#enamel)" stroke="url(#gold)" stroke-width="5"/>
 <path d="M205 259q-2-58 45-63q143 58 318 8q63-18 72 30" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="4"/>
 <path d="M278 254h280q41 0 40 48l-4 114M208 284l3 48" fill="none" stroke="url(#gold)" stroke-width="1.8"/>
 <path d="M271 227q76 24 139 20q71 0 141-20" fill="none" stroke="url(#gold)" stroke-width="2"/>
 <use href="#flower" x="313" y="233" transform="translate(0 20)"/>
 <use href="#flower" x="607" y="329"/>
 <use href="#flower" x="630" y="404" transform="rotate(20 630 404)"/>
 <path d="M591 269q54 5 46 56q-18 11-30-5q-12 3-17 25M597 363q-39 27 0 60q22 7 37-6" fill="none" stroke="url(#gold)" stroke-width="2.5"/>
 <text x="442" y="233" fill="url(#gold)" font-family="Georgia,serif" font-size="17" text-anchor="middle" letter-spacing="9">ZHUDA</text>
 <rect x="187" y="264" width="62" height="111" rx="24" fill="url(#steel)" stroke="#1e2832" stroke-width="3"/>
 <path d="M208 278v81m9-82v83m9-80v79" stroke="#e7edf2" opacity=".45"/>
 <use href="#screw" x="217" y="284"/><use href="#screw" x="217" y="354"/>
 <g class="needle"><rect x="210" y="371" width="10" height="62" rx="3" fill="url(#steel)"/>
 <path d="M215 428v26" stroke="#e6f2ff" stroke-width="2.5"/><path d="M215 448l-2 5" stroke="#647381"/></g>
 <path d="M231 374v60q0 12-12 12h-12v6h29v-9" fill="none" stroke="url(#steel)" stroke-width="6"/>
 <path class="thread" d="M311 142v22Q231 213 223 277l-8 151" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
 <g class="spool"><path d="M303 117h13v58h-13Z" fill="url(#steel)"/><rect x="287" y="130" width="43" height="32" rx="7" fill="var(--accent)"/>
 <path d="M288 135h40m-40 6h40m-40 6h40m-40 6h40" stroke="#fff" opacity=".38"/>
 <path d="M282 128h53m-53 36h53" stroke="url(#gold)" stroke-width="5"/></g>
 <rect x="356" y="377" width="197" height="81" rx="12" fill="#060c12" stroke="url(#gold)" stroke-width="3"/>
 <rect x="365" y="386" width="179" height="63" rx="6" fill="#111c25" stroke="#fff" stroke-opacity=".12"/>
 <text class="machine-screen-label" x="454" y="403" text-anchor="middle" fill="var(--accent)" font-family="system-ui,sans-serif" font-size="11" letter-spacing="3">待缝布料</text>
 <text id="stitch-count" x="454" y="436" text-anchor="middle" fill="var(--text)" font-family="system-ui,sans-serif" font-size="32" font-weight="800">3,000</text>
 <circle cx="675" cy="268" r="66" fill="url(#wheel)" stroke="#19222c" stroke-width="7"/>
 <g class="flywheel"><circle cx="675" cy="268" r="48" fill="none" stroke="url(#steel)" stroke-width="10"/>
 <path d="M675 220v96m-48-48h96m-82-34l68 68m0-68l-68 68" stroke="url(#steel)" stroke-width="9"/>
 <circle cx="675" cy="268" r="15" fill="url(#gold)"/><circle cx="675" cy="268" r="7" fill="url(#steel)"/></g>
 <path d="M727 263q15 150-31 253" fill="none" stroke="#121923" stroke-width="5"/>
 <path d="M726 263q15 150-31 253" fill="none" stroke="url(#gold)" stroke-width="1.5"/>
 <use href="#flower" x="224" y="504" transform="translate(67 145) scale(.7)"/>
 <path d="M340 504q38-21 68 0q29 21 58 0q29-21 58 0q29 21 58 0" fill="none" stroke="url(#gold)" stroke-width="2.5"/>
 <use href="#screw" x="160" y="494"/><use href="#screw" x="686" y="494"/>
 <path d="M173 537h500" stroke="#fff" stroke-opacity=".15" stroke-width="3"/>
</g></svg>`;
