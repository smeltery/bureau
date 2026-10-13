import { expect, test } from "bun:test";
import { summarizeBureauCurl } from "./bureau-curl.ts";
import { unwrapCurlFunction } from "./curl-wrapper.ts";

test("summarizes one literal wrapper call and its Python display filter", () => {
  const command = `B() { curl -s localhost:4000/api/tasks -H "Authorization: Bearer $TOKEN" -d "$1"; }; B '{"title":"Review"}' | python3 -c 'import json,sys; print(json.load(sys.stdin))'`;
  expect(summarizeBureauCurl(command)).toStartWith("Bureau API: tasks - title=Review, | python3 -c");
  expect(unwrapCurlFunction(`B() { curl localhost/api/tasks -d "$1"; }; B "literal"`)).toContain("-d 'literal'");
  expect(unwrapCurlFunction(`B() { curl localhost/api/tasks -d "$1"; }; B 'it'\\''s'`)).toContain("'it'\\''s'");
});

test("leaves ambiguous wrappers and active shell tails visible", () => {
  const prefix = `B() { curl localhost/api/tasks -d "$1"; }; B `;
  for (const argument of ["$BODY", '"$BODY"', "'{}' extra", "'{}'; echo hidden", "'{}' | python3 script.py", "'{}' | python -c 'print(1)' extra"]) {
    expect(summarizeBureauCurl(prefix + argument)).toBeNull();
  }
  for (const body of ["curl localhost/api/tasks; echo hidden", "curl localhost/api/tasks -d $1", 'curl localhost/api/tasks -d "$2"', 'curl localhost/api/tasks -H "$(echo hidden)"']) {
    expect(summarizeBureauCurl(`B() { ${body}; }; B '{}'`)).toBeNull();
  }
  expect(summarizeBureauCurl(`curl localhost/api/tasks | python3 -c "print($(echo hidden))"`)).toBeNull();
  expect(summarizeBureauCurl(`curl localhost/api/tasks | python -c 'print(1)' && echo hidden`)).toBeNull();
});

test("checks display filters after quoted URLs and refuses empty pipe stages", () => {
  expect(summarizeBureauCurl(`curl 'localhost/api/tasks' | python3 -c 'print(1)'`)).toContain("| python3");
  expect(summarizeBureauCurl(`curl 'localhost/api/tasks' | sh`)).toBeNull();
  expect(summarizeBureauCurl(`curl localhost/api/tasks || jq .`)).toBeNull();
});
