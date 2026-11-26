type Slots = {
  has(name: string): boolean;
  render(name: string): Promise<string>;
};

export async function slotContent(
  slots: Slots,
  name = "default",
): Promise<string> {
  if (!slots.has(name)) return "";
  const html = await slots.render(name);
  return html.replace(/<!--[\s\S]*?-->/g, "").trim();
}
