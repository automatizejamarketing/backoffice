import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_FILE_MAX_BYTES,
  CUSTOMER_FILE_XLSX_MAX_EXPANDED_BYTES,
  inspectCustomerFile,
  isCustomerFilePreviewCurrent,
  prepareCustomerFileXlsx,
} from "../lib/meta-business/marketing/audiences/customer-file";

const context = {
  customerId: "customer-1",
  adAccountId: "act_1",
  audienceId: "audience-1",
  operation: "add" as const,
};

const encoder = new TextEncoder();

function storedZip(entries: Record<string, string>, declaredUncompressedSize?: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const contents = encoder.encode(value);
    const local = new Uint8Array(30 + nameBytes.length + contents.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, contents.length, true);
    localView.setUint32(22, declaredUncompressedSize ?? contents.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(contents, 30 + nameBytes.length);
    parts.push(local);

    const record = new Uint8Array(46 + nameBytes.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true);
    recordView.setUint16(4, 20, true);
    recordView.setUint16(6, 20, true);
    recordView.setUint16(10, 0, true);
    recordView.setUint32(20, contents.length, true);
    recordView.setUint32(24, declaredUncompressedSize ?? contents.length, true);
    recordView.setUint16(28, nameBytes.length, true);
    recordView.setUint32(42, offset, true);
    record.set(nameBytes, 46);
    central.push(record);
    offset += local.length;
  }

  const centralSize = central.reduce((size, part) => size + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return Uint8Array.from([...parts, ...central, end].flatMap((part) => [...part]));
}

function workbook(sheets: Record<string, string>): Uint8Array {
  const names = Object.keys(sheets);
  return storedZip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": `<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>${names.map((name, index) => `<sheet name=\"${name}\" sheetId=\"${index + 1}\" r:id=\"rId${index + 1}\"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">${names.map((_, index) => `<Relationship Id=\"rId${index + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet${index + 1}.xml\"/>`).join("")}</Relationships>`,
    ...Object.fromEntries(Object.values(sheets).map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheet])),
  });
}

test("requires an explicit XLSX worksheet selection and produces the CSV-equivalent preview", () => {
  const bytes = workbook({
    Clientes: "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>email</t></is></c><c r=\"B1\" t=\"inlineStr\"><is><t>telefone</t></is></c></row><row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>CLIENTE@EXAMPLE.COM</t></is></c><c r=\"B2\" t=\"inlineStr\"><is><t>+1 415 555 2671</t></is></c></row></sheetData></worksheet>",
    Arquivo: "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData/></worksheet>",
  });

  assert.deepEqual(prepareCustomerFileXlsx({ bytes, mapping: { emailColumn: "email", phoneColumn: "telefone" }, context }), {
    format: "xlsx",
    selectionRequired: true,
    worksheets: ["Clientes", "Arquivo"],
  });

  const preview = prepareCustomerFileXlsx({
    bytes, worksheet: "Clientes", mapping: { emailColumn: "email", phoneColumn: "telefone" }, context,
  });
  assert.equal(preview.format, "xlsx");
  assert.equal(preview.worksheet, "Clientes");
  assert.deepEqual(preview.rows[0]?.identifiers, { email: "cliente@example.com", phone: "+14155552671" });
  assert.equal(isCustomerFilePreviewCurrent(preview, { ...preview, worksheet: "Arquivo" }), false);
});

test("inspects XLSX headers even when the selected worksheet has no data rows", () => {
  const bytes = workbook({
    Clientes: "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>email</t></is></c><c r=\"B1\" t=\"inlineStr\"><is><t>telefone</t></is></c></row></sheetData></worksheet>",
  });

  assert.deepEqual(inspectCustomerFile({ bytes, worksheet: "Clientes" }), {
    format: "xlsx",
    worksheet: "Clientes",
    headers: ["email", "telefone"],
  });
});

test("rejects unsafe XLSX expansion and formulas before a preview can be confirmed", () => {
  const tooLarge = storedZip({ "xl/workbook.xml": "<workbook/>" }, CUSTOMER_FILE_XLSX_MAX_EXPANDED_BYTES + 1);
  assert.throws(() => prepareCustomerFileXlsx({ bytes: tooLarge, worksheet: "Clientes", mapping: { emailColumn: "email" }, context }), /expansão/i);

  const formula = workbook({
    Clientes: "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>email</t></is></c></row><row r=\"2\"><c r=\"A2\"><f>HYPERLINK(\"https://example.com\")</f><v>cliente@example.com</v></c></row></sheetData></worksheet>",
  });
  assert.throws(() => prepareCustomerFileXlsx({ bytes: formula, mapping: { emailColumn: "email" }, context }), /fórmula/i);

  assert.throws(() => prepareCustomerFileXlsx({
    bytes: new Uint8Array(CUSTOMER_FILE_MAX_BYTES + 1), worksheet: "Clientes", mapping: { emailColumn: "email" }, context,
  }), /20 MB/);
});

test("rejects a workbook whose sheet relationship is not a worksheet", () => {
  const bytes = storedZip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": "<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Clientes\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
    "xl/_rels/workbook.xml.rels": "<Relationships><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/../sharedStrings.xml\"/></Relationships>",
    "xl/sharedStrings.xml": "<sst/>",
  });

  assert.throws(() => prepareCustomerFileXlsx({ bytes, mapping: { emailColumn: "email" }, context }), /relação válida/i);
});
