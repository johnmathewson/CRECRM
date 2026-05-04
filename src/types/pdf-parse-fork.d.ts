// Module declaration for pdf-parse-fork — Next-build-safe maintained fork
// of pdf-parse. Used by /api/properties/[id]/extract-from-om to extract
// raw text from uploaded PDF offering memorandums.

declare module "pdf-parse-fork" {
  interface PDFParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }
  function pdfParse(buffer: Buffer | Uint8Array): Promise<PDFParseResult>;
  export default pdfParse;
}
