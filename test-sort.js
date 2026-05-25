const list = [
  "EQ 0606 0990 8 TH",
  "EQ 0606 1027 9 TH",
  "EQ 0808 1027 9 TH",
  "EQ 0606 1028 2 TH",
  "EQ 0808 1028 2 TH",
  "EQ 0606 1029 6 TH",
  "EQ 0808 1029 6 TH"
];

const sorted = [...list].sort((a, b) => a.localeCompare(b));
console.log("SORTED:");
console.log(sorted);
