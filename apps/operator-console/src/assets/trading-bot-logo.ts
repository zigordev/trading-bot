const tradingBotLogoSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <title>Trading bot icon</title>
  <g id="robot">
    <rect x="190" y="275" width="300" height="170" rx="80" fill="white" stroke="#0B3768" stroke-width="16"/>
    <rect x="255" y="325" width="170" height="75" rx="36" fill="#0B3768"/>
    <circle cx="305" cy="362" r="16" fill="white"/>
    <circle cx="397" cy="362" r="16" fill="white"/>
    <ellipse cx="210" cy="360" rx="28" ry="45" fill="white" stroke="#0B3768" stroke-width="16"/>
    <ellipse cx="470" cy="360" rx="28" ry="45" fill="white" stroke="#0B3768" stroke-width="16"/>
    <path d="M215 520C255 470 420 470 510 520" stroke="#0B3768" stroke-width="18" stroke-linecap="round"/>
  </g>
  <g id="candle-left">
    <rect x="510" y="520" width="78" height="160" rx="14" fill="#1E90D8"/>
    <rect x="543" y="470" width="12" height="260" rx="6" fill="#0B3768"/>
  </g>
  <g id="arm">
    <path d="M330 610L515 525" stroke="#0B3768" stroke-width="28" stroke-linecap="round"/>
    <path d="M330 610L520 640" stroke="#0B3768" stroke-width="28" stroke-linecap="round"/>
    <circle cx="325" cy="610" r="56" fill="white" stroke="#0B3768" stroke-width="16"/>
    <circle cx="325" cy="610" r="20" fill="#0B3768"/>
    <circle cx="530" cy="535" r="38" fill="white" stroke="#0B3768" stroke-width="16"/>
    <circle cx="530" cy="535" r="15" fill="#0B3768"/>
    <path d="M560 500L615 486C633 482 646 492 646 505C646 516 638 524 624 528L588 536" stroke="#0B3768" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M560 570L615 575C633 577 646 566 646 553C646 542 638 534 624 531L590 527" stroke="#0B3768" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g id="candle-green">
    <rect x="620" y="485" width="86" height="175" rx="14" fill="#22B24C"/>
    <rect x="657" y="430" width="12" height="290" rx="6" fill="#0B3768"/>
  </g>
  <g id="candle-right">
    <rect x="730" y="425" width="88" height="170" rx="14" fill="#1E90D8"/>
    <rect x="768" y="370" width="12" height="280" rx="6" fill="#0B3768"/>
  </g>
</svg>`;

const encodeBase64 = (value: string) => {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }

  return value;
};

export const tradingBotLogoUri = `data:image/svg+xml;base64,${encodeBase64(
  tradingBotLogoSvg,
)}`;
