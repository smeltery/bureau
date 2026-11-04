const icons: Record<string, string> = {
  ChatGPT: 'chat/chatgpt',
  Claude: 'chat/claude',
  v0: 'chat/v0',
  'T3 Chat': 'chat/t3',
  Scira: 'chat/scira',
  Cursor: 'chat/cursor',
  GitHub: 'github',
};

export function BrandIcon({ name, size = 20 }: { name: string; size?: number }) {
  const icon = icons[name];
  return icon ? <img className="brand-icon" src={`/brands/${icon}.svg`} width={size} height={size} alt="" /> : null;
}
