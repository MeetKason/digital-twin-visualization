const icons: Record<string, string> = {
  home: "4f3c4.svg",
  roam: "be045.svg",
  station: "23c7d.svg",
  weather: "0875e.svg",
  device: "9eae8.svg",
  settings: "0737f.svg",
  user: "29383.svg",
  chevron: "17721.svg",
  layers: "65ff1.svg",
  tools: "c1c35.svg",
  north: "2b899.svg",
  plus: "bc58c.svg",
  minus: "e21b3.svg",
  fullscreen: "10a3f.svg",
  locate: "efdb2.svg",
  search: "0a56c.svg",
  play: "7cbc9.svg",
  previous: "8a592.svg",
  next: "42758.svg",
};
export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span className="icon" style={{ width: size, height: size }}>
      <img src={`/design/${icons[name] ?? icons.home}`} alt="" />
    </span>
  );
}
