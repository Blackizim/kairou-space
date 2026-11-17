
/**
 * VIP é um campo de faturamento: só o servidor escreve.
 * Qualquer cliente autenticado que tente alterar `vip_until` ou `plan`
 * recebe 400 — a concessão passa pelo webhook /api/vip/activate.
 */
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    e.next();
    return;
  }

  const original = e.record.original();
  const triesVip =
    e.record.get("vip_until") !== original.get("vip_until") ||
    e.record.get("plan") !== original.get("plan");

  if (triesVip) {
    throw new BadRequestError("campo protegido: VIP só é concedido pelo servidor");
  }

  e.next();
}, "users");
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth() && (e.record.get('vip_until') || e.record.get('plan'))) {
    throw new BadRequestError('campo protegido: VIP só é concedido pelo servidor');
  }
  e.next();
}, 'users');
