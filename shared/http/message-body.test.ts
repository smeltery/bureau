import { expect, test } from "bun:test";
import { parseMessageBody } from "./message-body.ts";

test("plain messages preserve shell-sensitive text and decode delivery options", () => {
  const text = 'He said "hi"\n$HOME `cmd` \\ path\n';
  expect(parseMessageBody(text, "Text/Plain; charset=utf-8", "?deliverAt=2099-01-01T12:00:00+02:00&clientMessageId=a%20b")).toEqual({
    ok: true,
    body: { text, clientMessageId: "a b", deliverAt: "2099-01-01T12:00:00+02:00" },
  });
  expect(parseMessageBody(text, "text/plain", "?steer=1&sendNow=false")).toEqual({ ok: true, body: { text, steer: true, sendNow: false } });
});

test("JSON callers retain their fields, including fetch's default content type", () => {
  const body = { text: "message", attachments: [], clientMessageId: "a" };
  for (const contentType of [null, "application/json", "text/plain;charset=UTF-8"]) {
    expect(parseMessageBody(JSON.stringify(body), contentType, "")).toEqual({ ok: true, body });
  }
  expect(parseMessageBody('{"text":"literal"}', "text/plain", "?steer=1")).toEqual({ ok: true, body: { text: '{"text":"literal"}', steer: true } });
});

test("invalid query options cannot silently change delivery", () => {
  for (const query of ["?steer=yes", "?steer", "?steer=1&steer=0", "?text=other", "?senderAgentId=other", "?__proto__=x", "?deliverAt=%ZZ", "?%ZZ=x"]) {
    expect(parseMessageBody("hello", "text/plain", query)).toMatchObject({ ok: false, status: 422 });
  }
  expect(parseMessageBody('{"text":"hello"}', "application/json", "?steer=1")).toMatchObject({ ok: false, status: 422 });
  expect(parseMessageBody("hello", "text/plain", "?steer=1", {})).toMatchObject({ ok: false, status: 422 });
  for (const body of ["null", "[]", "invalid"]) expect(parseMessageBody(body, "application/json", "")).toMatchObject({ ok: false, status: 400 });
});
