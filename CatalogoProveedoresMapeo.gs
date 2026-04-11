function construirMapasCatalogoProveedores(rows) {
  const catalogo = { aliasMap: {}, rucMap: {} };
  for (let i = 0; i < rows.length; i++) {
    const canonico = limpiarTexto(rows[i][0]);
    const aliasRaw = limpiarTexto(rows[i][1]);
    const rucRaw = limpiarTexto(rows[i][2]);
    const activo = parseBooleanCell(rows[i][4]);
    if (!canonico || !activo) continue;

    const canonicoOficial = limpiarTexto(canonico);
    const canonicoLimpio = normalizarNombreProveedorBase(canonicoOficial);
    if (canonicoLimpio) {
      catalogo.aliasMap[canonicoLimpio] = canonicoOficial;
    }

    const rucNorm = normalizarRuc(rucRaw);
    if (rucNorm) {
      catalogo.rucMap[rucNorm] = canonicoOficial;
    }

    if (!aliasRaw) continue;
    const aliasList = aliasRaw.split(/[|,;\n]/);
    for (let j = 0; j < aliasList.length; j++) {
      const aliasLimpio = normalizarNombreProveedorBase(aliasList[j]);
      if (!aliasLimpio) continue;
      catalogo.aliasMap[aliasLimpio] = canonicoOficial;
    }
  }
  return catalogo;
}
