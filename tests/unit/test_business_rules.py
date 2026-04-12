import unittest

from app.domain.invoice_rules import validate_ocr_amounts
from app.services.parsing import extract_invoice_fields_from_text, validate_invoice_result


class BusinessRulesTests(unittest.TestCase):
    def test_supplier_only_written_when_match(self) -> None:
        text = """
        TIENDA X
        FACTURA #A1
        TOTAL: 10.00
        """
        result = extract_invoice_fields_from_text(text)
        self.assertIsNone(result.proveedor)

    def test_supplier_ruc_exact_match(self) -> None:
        text = """
        Mega LOKO
        RUC: 155701584-2-2021
        FACTURA #F-102
        Total: 25.00
        """
        result = extract_invoice_fields_from_text(text)
        self.assertEqual(result.proveedor, "MEGA LONG, S.A.")
        self.assertEqual(result.proveedor_match_motivo, "match_ruc_exact")

    def test_ocr_total_rule_over_1000(self) -> None:
        total, itbms, obs, metrics = validate_ocr_amounts(1200.0, 1.0)
        self.assertIsNone(total)
        self.assertEqual(itbms, 1.0)
        self.assertTrue(metrics.invalid_total)
        self.assertIn("Total inválido para OCR (>1000)", obs)

    def test_ocr_itbms_rule_over_7_percent(self) -> None:
        total, itbms, obs, metrics = validate_ocr_amounts(100.0, 8.0)
        self.assertEqual(total, 100.0)
        self.assertIsNone(itbms)
        self.assertTrue(metrics.invalid_itbms)
        self.assertIn("ITBMS inválido para OCR (>7% del total)", obs)

    def test_validate_result_applies_ocr_rules(self) -> None:
        parsed = extract_invoice_fields_from_text("Factura\nTotal: 1500.00\nITBMS: 120.00")
        validated, metrics = validate_invoice_result(parsed)
        self.assertEqual(validated.metodo_extraccion, "ocr")
        self.assertIsNone(validated.total)
        self.assertFalse(metrics["invalid_itbms"])  # sin total válido no evalúa ratio


if __name__ == "__main__":
    unittest.main()
