import { expect, test } from "bun:test";
import { authLanguage } from "./language.ts";

test("preauth language respects supported selections and weighted browser preferences", () => {
  const request = (value: string) => new Request("http://office.test/", { headers: { "accept-language": value } });
  expect(authLanguage(request("fr-FR, ca-ES;q=0.8, es;q=0.9"))).toBe("es");
  expect(authLanguage(request("es;q=0.1, en;q=invalid, zh-CN;q=0.9"))).toBe("zh");
  expect(authLanguage(request("es;q=0, ca;q=2, zh;q=-1"))).toBe("en");
  expect(authLanguage(request("es"), "ca")).toBe("ca");
  expect(authLanguage(request("es"), "<script>")).toBe("es");
  expect(authLanguage(request("fr"))).toBe("en");
});
