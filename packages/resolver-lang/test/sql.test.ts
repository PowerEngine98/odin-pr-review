import { describe, expect, it } from "vitest";

import { POSTGRES, SQL } from "../src/sql.js";
import { indexFile, type SymbolIndex } from "../src/index-build.js";

const fresh = (): SymbolIndex => ({
  byName: new Map(),
  files: new Map(),
  byScope: new Map(),
});

const names = (dialect: typeof SQL, line: string) =>
  dialect.candidates(line).map((c) => c.name);

describe("what a migration creates", () => {
  const source = [
    "CREATE TABLE IF NOT EXISTS invoices (",
    "  id uuid PRIMARY KEY,",
    "  customer_id uuid NOT NULL REFERENCES customers (id)",
    ");",
    "",
    "CREATE UNIQUE INDEX invoices_number_idx ON invoices (number);",
    "CREATE MATERIALIZED VIEW invoice_totals AS SELECT 1;",
    "CREATE OR REPLACE FUNCTION bill(invoice uuid) RETURNS void AS $$",
    "BEGIN END; $$ LANGUAGE plpgsql;",
    "CREATE SEQUENCE invoice_numbers;",
    "CREATE TYPE invoice_state AS ENUM ('draft', 'sent');",
  ].join("\n");

  const { facts, declarations } = SQL.read("db/migrations/002_invoices.sql", source);

  it("finds every kind of object, in the order they are made", () => {
    expect(declarations.map((d) => `${d.kind} ${d.name}`)).toEqual([
      "table invoices",
      "index invoices_number_idx",
      "view invoice_totals",
      "function bill",
      "sequence invoice_numbers",
      "type invoice_state",
    ]);
  });

  it("puts a file in the public schema unless it says otherwise", () => {
    expect(facts.scope).toBe("public");
    expect(SQL.read("a.sql", "SET search_path TO billing, public;\n").facts.scope)
      .toBe("billing");
    expect(SQL.read("a.sql", "CREATE SCHEMA billing;\n").facts.scope).toBe("billing");
  });

  it("takes a qualified object's schema from the name it was written with", () => {
    const { declarations: qualified } = SQL.read(
      "a.sql",
      "CREATE TABLE billing.invoices (id uuid);",
    );
    expect(qualified[0]).toMatchObject({ name: "invoices", scope: "billing" });
  });

  it("unquotes a name that had to be quoted", () => {
    const { declarations: quoted } = SQL.read("a.sql", 'CREATE TABLE "order" (id uuid);');
    expect(quoted[0]?.name).toBe("order");
  });
});

describe("what a statement points at", () => {
  it("follows a foreign key to the table it references", () => {
    expect(names(SQL, "  customer_id uuid REFERENCES customers (id)")).toEqual([
      "customers",
    ]);
  });

  it("follows reads and writes", () => {
    expect(names(SQL, "SELECT * FROM invoices JOIN customers ON customers.id = c")).toContain("invoices");
    expect(names(SQL, "INSERT INTO audit_log (what) VALUES ('x')")).toEqual(["audit_log"]);
    expect(names(SQL, "UPDATE invoices SET total = 0")).toEqual(["invoices"]);
    expect(names(SQL, "ALTER TABLE ONLY invoices ADD COLUMN paid_at timestamptz")).toEqual([
      "invoices",
    ]);
  });

  it("keeps the schema a qualified reference names", () => {
    expect(SQL.candidates("SELECT * FROM billing.invoices")[0]).toMatchObject({
      name: "invoices",
      receiver: "billing",
    });
  });

  it("says nothing about the language itself", () => {
    expect(names(SQL, "SELECT count(*) FROM (VALUES (1)) AS t")).toEqual([]);
  });

  it("ignores what a comment mentions", () => {
    expect(names(SQL, "-- drop table invoices when the migration lands")).toEqual([]);
  });
});

describe("the parts that are only Postgres", () => {
  it("follows a trigger to the function it runs", () => {
    expect(names(POSTGRES, "  EXECUTE FUNCTION touch_updated_at();")).toEqual([
      "touch_updated_at",
    ]);
    expect(names(POSTGRES, "  PERFORM refresh_totals();")).toEqual(["refresh_totals"]);
  });

  it("follows a sequence read through nextval", () => {
    expect(names(POSTGRES, "  number bigint DEFAULT nextval('invoice_numbers')")).toEqual([
      "invoice_numbers",
    ]);
  });

  it("follows a partition to its parent and a table to what it inherits", () => {
    expect(names(POSTGRES, "CREATE TABLE events_2026 PARTITION OF events")).toContain("events");
    expect(names(POSTGRES, "CREATE TABLE staff () INHERITS (people)")).toContain("people");
  });

  it("follows a cast to the type somebody declared", () => {
    expect(names(POSTGRES, "  SELECT state::invoice_state")).toContain("invoice_state");
  });

  it("finds the objects only Postgres has", () => {
    const { declarations } = POSTGRES.read(
      "a.sql",
      "CREATE POLICY tenant_isolation ON invoices;\nCREATE EXTENSION IF NOT EXISTS pgcrypto;",
    );
    expect(declarations.map((d) => `${d.kind} ${d.name}`)).toEqual([
      "policy tenant_isolation",
      "extension pgcrypto",
    ]);
  });

  it("leaves the portable dialect alone", () => {
    // A plain SQL project should not gain arrows from syntax it cannot use.
    expect(names(SQL, "  EXECUTE FUNCTION touch_updated_at();")).toEqual([]);
    expect(names(SQL, "  SELECT state::invoice_state")).toEqual([]);
  });
});

describe("the index over a set of migrations", () => {
  it("groups objects by name and files by schema", () => {
    const index = fresh();
    indexFile(index, SQL, "db/001_customers.sql", "CREATE TABLE customers (id uuid);");
    indexFile(index, SQL, "db/002_invoices.sql", "CREATE TABLE invoices (id uuid);");

    expect(index.byName.get("customers")?.[0]?.path).toBe("db/001_customers.sql");
    expect(index.byScope.get("public")).toEqual([
      "db/001_customers.sql",
      "db/002_invoices.sql",
    ]);
  });
});
