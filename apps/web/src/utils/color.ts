export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function getAccessibleTextColor(value: string): "#ffffff" | "#14233d" {
  if (!isHexColor(value)) return "#ffffff";
  const channels = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.48 ? "#14233d" : "#ffffff";
}
