import io
import unittest

from PIL import Image

from app.services.pipeline import run_document_pipeline


class PipelineIntegrationTests(unittest.TestCase):
    def _png_bytes(self) -> bytes:
        img = Image.new("RGB", (10, 10), color=(255, 255, 255))
        buff = io.BytesIO()
        img.save(buff, format="PNG")
        return buff.getvalue()

    def test_consulta_cufe_sets_method_and_confidence(self) -> None:
        output = run_document_pipeline(
            file_bytes=self._png_bytes(),
            mime_type="image/png",
            file_name="ABCDEF0123456789ABCDEF0123456789.pdf",
        )
        self.assertEqual(output.result.metodo_extraccion, "consulta_cufe")
        self.assertEqual(output.result.confianza, 1.0)
        self.assertEqual(output.metrics.method, "consulta_cufe")

    def test_ocr_path_keeps_method_and_metrics(self) -> None:
        output = run_document_pipeline(
            file_bytes=self._png_bytes(),
            mime_type="image/png",
            file_name="factura-sin-cufe.png",
        )
        self.assertEqual(output.result.metodo_extraccion, "ocr")
        self.assertGreaterEqual(output.metrics.empty_fields_rate, 0)


if __name__ == "__main__":
    unittest.main()
