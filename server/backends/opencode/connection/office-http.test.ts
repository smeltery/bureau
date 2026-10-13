import { expect, test } from "bun:test";
import { OfficeRequestReader, OfficeResponseWriter } from "./office-http.ts";

test("request framing retains fragmented binary bodies and admits before body bytes", () => {
  const reader = new OfficeRequestReader();
  let admitted = 0;
  const admit = () => {
    admitted++;
  };
  expect(reader.read(Buffer.from("PUT /api/apps/a/thumbnail HTTP/1.1\r\nContent-Length: 4\r\nContent-Type: image/png\r\nExpect: 100-continue\r\n\r\n"), admit)).toBeNull();
  expect(admitted).toBe(1);
  expect(reader.read(Buffer.from([0, 255]), admit)).toBeNull();
  const request = reader.read(Buffer.from([254, 128]), admit)!;
  expect(request.body).toEqual(Buffer.from([0, 255, 254, 128]));
  expect(request.headers.get("content-type")).toBe("image/png");
  expect(admitted).toBe(1);
});

test("ambiguous framing, oversized bodies and alternate hosts fail closed", () => {
  for (const head of ["Content-Length: 1\r\nContent-Length: 2", "Transfer-Encoding: chunked", "Content-Length: 999999999", "Expect: anything"])
    expect(() => new OfficeRequestReader().read(Buffer.from(`POST /api/tasks HTTP/1.1\r\n${head}\r\n\r\n`), () => {})).toThrow();
  expect(() => new OfficeRequestReader().read(Buffer.from("GET //other.example/api/tasks HTTP/1.1\r\n\r\n"), () => {})).toThrow();
});

test("partial and zero socket writes drain completely before closing", () => {
  const received: Buffer[] = [];
  let capacity = 0,
    ended = 0;
  const writer = new OfficeResponseWriter({
    write(data) {
      const count = Math.min(capacity, data.length);
      received.push(Buffer.from(data.subarray(0, count)));
      return count;
    },
    end() {
      ended++;
    },
    terminate() {
      throw new Error("unexpected termination");
    },
  });
  writer.send(Buffer.from("100 Continue"), false);
  expect(ended).toBe(0);
  capacity = 3;
  writer.send(Buffer.from("final response"));
  for (let i = 0; i < 12; i++) writer.drain();
  expect(Buffer.concat(received).toString()).toBe("100 Continuefinal response");
  expect(ended).toBe(1);
});
