"""
LearnSphere document processor (optional).

Extracts text from PDF / DOCX / DOC / TXT. For scanned PDF pages (no text layer) it runs Tesseract OCR.
The Node API calls POST /extract when PROCESSOR_URL is set, and falls back to its built-in parsers otherwise.
"""
import io
import os
import shutil
import subprocess
import tempfile

from flask import Flask, jsonify, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
MIN_CHARS_PER_PAGE = 40          # below this a page is treated as scanned
OCR_DPI = int(os.environ.get("OCR_DPI", "200"))
OCR_LANG = os.environ.get("OCR_LANG", "eng")


def pdf_text(data: bytes):
    import fitz  # PyMuPDF
    doc = fitz.open(stream=data, filetype="pdf")
    pages, ocr_used = [], False
    for page in doc:
        text = page.get_text("text") or ""
        if len(text.strip()) < MIN_CHARS_PER_PAGE:
            ocr_text = ocr_page(page)
            if ocr_text is not None:
                text, ocr_used = ocr_text, True
        pages.append(text)
    return "\n".join(pages), ocr_used


def ocr_page(page):
    """Returns OCR text, or None when pytesseract / the tesseract binary is not installed."""
    try:
        import pytesseract
        from PIL import Image
        if not shutil.which("tesseract"):
            return None
        pix = page.get_pixmap(dpi=OCR_DPI)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        return pytesseract.image_to_string(img, lang=OCR_LANG)
    except Exception:
        return None


def docx_text(data: bytes):
    import docx
    document = docx.Document(io.BytesIO(data))
    parts = [p.text for p in document.paragraphs]
    for table in document.tables:                       # question papers often put MCQs in tables
        for row in table.rows:
            parts.append(" ".join(cell.text.strip() for cell in row.cells if cell.text.strip()))
    return "\n".join(parts)


def doc_text(data: bytes):
    """Legacy .doc: convert to .docx with LibreOffice, then read it."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("LibreOffice is required to read .doc files. Install it or save the file as .docx.")
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "in.doc")
        open(src, "wb").write(data)
        subprocess.run([soffice, "--headless", "--convert-to", "docx", "--outdir", tmp, src], check=True, timeout=90, capture_output=True)
        return docx_text(open(os.path.join(tmp, "in.docx"), "rb").read())


@app.get("/health")
def health():
    return jsonify(status="ok", ocr=bool(shutil.which("tesseract")), doc=bool(shutil.which("soffice") or shutil.which("libreoffice")))


@app.post("/extract")
def extract():
    f = request.files.get("file")
    if not f:
        return jsonify(error="No file uploaded"), 400
    name = (f.filename or "").lower()
    data = f.read()
    try:
        if name.endswith(".pdf"):
            text, ocr = pdf_text(data)
        elif name.endswith(".docx"):
            text, ocr = docx_text(data), False
        elif name.endswith(".doc"):
            text, ocr = doc_text(data), False
        elif name.endswith(".txt"):
            text, ocr = data.decode("utf-8", errors="replace"), False
        else:
            return jsonify(error="Unsupported file type"), 400
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 422
    return jsonify(text=text, ocr_used=ocr)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8001")))
