import unittest

from app.services.parsing import extract_invoice_fields_from_text


class SupplierNormalizationTests(unittest.TestCase):
    def test_ruc_exact_overrides_noisy_alias(self) -> None:
        ocr_text = """
        Mega LOKO
        RUC: 155701584-2-2021
        FACTURA #F-102
        Total: 25.00
        """

        result = extract_invoice_fields_from_text(ocr_text)

        self.assertEqual(result.nombre_marca_detectado, "Mega LOKO")
        self.assertEqual(result.ruc_detectado, "155701584-2-2021")
        self.assertEqual(result.proveedor, "MEGA LONG, S.A.")
        self.assertEqual(result.proveedor_match_motivo, "match_ruc_exact")
        self.assertEqual(result.proveedor_match_score, 1.0)


if __name__ == "__main__":
    unittest.main()
