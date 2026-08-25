const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const SUPABASE_URL = 'https://sutietwbqbpnonlyqifa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RgzowU0HaxIvSfpjpEX3NA_n0ydUtym';

function cleanText(value, max = 600) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\xFF]/g, '')
    .trim()
    .slice(0, max);
}
function money(v) {
  const n = Number(v || 0);
  return `R$ ${Math.round(n).toLocaleString('pt-BR')}`;
}
function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
}
async function supabaseFetch(path, token, options = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}
async function getUser(token) {
  const r = await supabaseFetch('/auth/v1/user', token);
  return r.ok ? r.json() : null;
}
async function getProfile(token, userId) {
  const r = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,full_name,business_name,whatsapp,professional_city`, token);
  if (!r.ok) return null;
  return (await r.json())?.[0] || null;
}
async function getAnalysis(token, id) {
  const r = await supabaseFetch(`/rest/v1/analyses?id=eq.${encodeURIComponent(id)}&select=*`, token);
  if (!r.ok) return null;
  return (await r.json())?.[0] || null;
}
async function saveProposal(token, body) {
  const r = await supabaseFetch('/rest/v1/proposals', token, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('proposal_save_failed');
  return (await r.json())?.[0] || null;
}
function wrapText(text, font, size, maxWidth) {
  const words = cleanText(text, 3000).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}
async function buildPdf({ analysis, profile, clientName, validityDays, note, proposalId }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const orange = rgb(0.976, 0.451, 0.086);
  const ink = rgb(0.063, 0.094, 0.157);
  const muted = rgb(0.40, 0.44, 0.52);
  const lineColor = rgb(0.88, 0.90, 0.93);
  const pale = rgb(0.98, 0.98, 0.99);
  const pageSize = [595.28, 841.89];
  const margin = 38;
  const maxWidth = pageSize[0] - margin * 2;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - 40;

  const newPage = () => {
    page = pdf.addPage(pageSize);
    y = pageSize[1] - 40;
  };
  const ensure = (need = 48) => { if (y < margin + need) newPage(); };
  const text = (value, size = 9, opts = {}) => {
    const font = opts.bold ? bold : regular;
    const color = opts.color || ink;
    const lines = wrapText(value, font, size, opts.width || maxWidth);
    const lh = opts.lineHeight || size * 1.25;
    ensure(lines.length * lh + 6);
    for (const line of lines) {
      page.drawText(line, { x: opts.x || margin, y, size, font, color });
      y -= lh;
    }
    if (opts.after) y -= opts.after;
  };
  const section = title => {
    ensure(34);
    y -= 3;
    page.drawText(cleanText(title, 80), { x: margin, y, size: 10.5, font: bold, color: ink });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageSize[0] - margin, y }, thickness: .8, color: lineColor });
    y -= 12;
  };
  const bulletList = (items, maxItems = 6) => {
    const arr = Array.isArray(items) ? items.slice(0, maxItems) : [];
    if (!arr.length) return text('Nenhum item adicional.', 8.2, { color: muted, after: 2 });
    for (const item of arr) {
      ensure(22);
      const lines = wrapText(cleanText(item, 220), regular, 8.2, maxWidth - 14);
      page.drawText('•', { x: margin, y, size: 8.5, font: bold, color: orange });
      for (let i = 0; i < lines.length; i++) {
        page.drawText(lines[i], { x: margin + 12, y, size: 8.2, font: regular, color: ink });
        y -= 10;
      }
      y -= 1;
    }
  };

  page.drawText('Orça.AI', { x: margin, y, size: 18, font: bold, color: ink });
  page.drawText('PROPOSTA DE PRÉ-ORÇAMENTO', { x: margin, y: y - 23, size: 19, font: bold, color: orange });
  y -= 51;

  const business = cleanText(profile.business_name || profile.full_name || 'Profissional de pintura', 120);
  text(business, 12.5, { bold: true, after: 1 });
  const contactBits = [];
  if (profile.whatsapp) contactBits.push(`WhatsApp: ${cleanText(profile.whatsapp, 40)}`);
  contactBits.push('Sorocaba/SP');
  if (proposalId) contactBits.push(`Proposta ${cleanText(proposalId, 12).toUpperCase()}`);
  text(contactBits.join('  •  '), 8.4, { color: muted, after: 9 });

  if (clientName) {
    text('Cliente', 8.5, { bold: true, color: muted, after: 1 });
    text(cleanText(clientName, 120), 10.5, { bold: true, after: 7 });
  }

  section('Serviço analisado');
  text(`${cleanText(analysis.room || 'Pintura', 60)} - ${analysis.scope === 'parede' ? 'uma parede' : 'cômodo inteiro'}`, 10.5, { bold: true, after: 2 });
  text(`Local: ${cleanText(analysis.neighborhood || 'Bairro não informado', 120)}, Sorocaba/SP`, 8.5, { color: muted });
  text(`Complexidade visual: ${cleanText(analysis.complexity || 'não definida', 30)}`, 8.5, { color: muted });
  if (analysis.estimated_area_m2) text(`Área estimada de pintura: ${analysis.estimated_area_m2} m²`, 8.5, { color: muted, after: 4 });

  section('Faixa inicial sugerida');
  ensure(70);
  page.drawRectangle({ x: margin, y: y - 48, width: maxWidth, height: 58, color: pale, borderColor: lineColor, borderWidth: 1 });
  page.drawText(`${money(analysis.price_min)} a ${money(analysis.price_max)}`, { x: margin + 15, y: y - 15, size: 18, font: bold, color: ink });
  page.drawText('Faixa de pré-orçamento remoto', { x: margin + 15, y: y - 34, size: 8.2, font: regular, color: muted });
  y -= 63;
  if (analysis.labor_min != null) text(`Mão de obra estimada: ${money(analysis.labor_min)} a ${money(analysis.labor_max)}`, 8.8, { bold: true });
  if (analysis.materials_min != null) text(`Materiais estimados: ${money(analysis.materials_min)} a ${money(analysis.materials_max)}`, 8.8, { bold: true, after: 3 });

  section('Resumo da análise');
  text(cleanText(analysis.summary || 'Pré-análise gerada a partir das fotos e dados enviados.', 620), 8.8, { after: 5 });
  if (analysis.wall_state) {
    text('Estado aparente', 8.8, { bold: true, after: 1 });
    text(cleanText(analysis.wall_state, 320), 8.2, { color: muted, after: 5 });
  }

  section('Materiais possivelmente necessários');
  bulletList(analysis.materials, 6);
  section('Pontos de atenção');
  bulletList(analysis.attention_points, 5);

  if (note) {
    section('Observação do profissional');
    text(cleanText(note, 500), 8.4, { after: 4 });
  }

  section('Validade e condições');
  const created = new Date();
  const validUntil = new Date(created.getTime() + validityDays * 86400000);
  text(`Validade: ${validityDays} dias, até ${validUntil.toLocaleDateString('pt-BR')}.`, 8.5, { bold: true, after: 3 });
  text('Pré-orçamento remoto baseado nas fotos, medidas e informações fornecidas. Problemas ocultos, condições reais do local, mudanças de escopo ou materiais podem alterar o valor. O preço definitivo deve ser confirmado pelo profissional.', 7.7, { color: muted, after: 5 });

  ensure(26);
  y -= 3;
  page.drawLine({ start: { x: margin, y }, end: { x: pageSize[0] - margin, y }, thickness: .8, color: lineColor });
  y -= 13;
  text('Gerado pelo Orça.AI', 7.5, { color: muted });

  pdf.setTitle('Proposta de pré-orçamento Orça.AI');
  pdf.setAuthor(business);
  pdf.setSubject('Pré-orçamento de pintura residencial');
  return Buffer.from(await pdf.save());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Entre na sua conta para gerar a proposta.' });

  try {
    const user = await getUser(token);
    if (!user?.id) return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
    const profile = await getProfile(token, user.id);
    if (!profile) return res.status(404).json({ error: 'Perfil não encontrado.' });
    if (profile.plan !== 'pro') return res.status(403).json({ error: 'A proposta em PDF é um recurso do plano Pro.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const analysisId = String(body.analysis_id || '');
    if (!isUuid(analysisId)) return res.status(400).json({ error: 'Análise inválida.' });
    const clientName = cleanText(body.client_name, 120);
    const note = cleanText(body.note, 500);
    const validityDays = Math.min(60, Math.max(1, Number.parseInt(body.validity_days, 10) || 7));

    const analysis = await getAnalysis(token, analysisId);
    if (!analysis || analysis.user_id !== user.id) return res.status(404).json({ error: 'Análise não encontrada.' });

    const proposal = await saveProposal(token, {
      user_id: user.id,
      analysis_id: analysisId,
      client_name: clientName || null,
      validity_days: validityDays,
      note: note || null
    });
    const pdf = await buildPdf({ analysis, profile, clientName, validityDays, note, proposalId: proposal?.id });
    const shortId = String(proposal?.id || analysisId).slice(0, 8);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proposta-orca-ai-${shortId}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  } catch (error) {
    console.error('gerar-proposta:', error);
    return res.status(500).json({ error: 'Não foi possível gerar a proposta agora.' });
  }
};
