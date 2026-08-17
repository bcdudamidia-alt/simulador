import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { parseAmountToCents } from '../../lib/money.ts';
import { buildDedupeHash, extractInstallment, normalizeDescription } from './normalize.ts';
import { parseOfx, parseOfxDate, OfxParseError } from './ofx-parser.ts';

/**
 * O parser é puro (bytes → dados), então dá para testar o zoológico inteiro de
 * formatos de banco sem banco, sem HTTP e sem mock. Cada caso aqui saiu de um
 * arquivo real que quebrou alguma implementação ingênua.
 *
 * Rodar:  npm test --workspace @pareo/api
 */

// ─── OFX 1.x (SGML): o formato que os bancos brasileiros realmente exportam ───
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20260115103000[-3:BRT]
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1001
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>341
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260131
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260105120000[-3:BRT]
<TRNAMT>-127.90
<FITID>202601050001
<MEMO>PAG*PADARIA BELA VISTA 05/01 SAO PAULO BR
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260105
<TRNAMT>8750.00
<FITID>202601050002
<MEMO>SALARIO EMPRESA XYZ LTDA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260110
<TRNAMT>-2500.00
<FITID>202601100003
<NAME>ALUGUEL
<MEMO>PIX ENVIADO 10/01 IMOBILIARIA CENTRO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>15320.45
<DTASOF>20260131
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

// ─── OFX 2.x (XML), com fatura de cartão ───
const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="200" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <TRNUID>2001</TRNUID>
      <CCSTMTRS>
        <CURDEF>BRL</CURDEF>
        <CCACCTFROM><ACCTID>4111XXXXXXXX1234</ACCTID></CCACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20260101</DTSTART>
          <DTEND>20260131</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260112</DTPOSTED>
            <TRNAMT>-349.00</TRNAMT>
            <FITID>CC-001</FITID>
            <MEMO>NETSHOES 03/12</MEMO>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260118</DTPOSTED>
            <TRNAMT>-59.90</TRNAMT>
            <FITID>CC-002</FITID>
            <MEMO>SPOTIFY &amp; CIA</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`;

describe('parseOfx — OFX 1.x (SGML)', () => {
  const doc = parseOfx(OFX_SGML);
  const stmt = doc.statements[0]!;

  test('reconhece um extrato de conta corrente', () => {
    assert.equal(doc.statements.length, 1);
    assert.equal(stmt.kind, 'bank');
    assert.equal(stmt.currency, 'BRL');
  });

  test('extrai a identificação da conta', () => {
    assert.equal(stmt.bankId, '341');
    assert.equal(stmt.accountId, '12345-6');
    assert.equal(stmt.accountType, 'CHECKING');
  });

  test('extrai as três transações', () => {
    assert.equal(stmt.transactions.length, 3);
  });

  test('preserva o sinal: débito negativo, crédito positivo', () => {
    assert.equal(stmt.transactions[0]!.amountCents, -12790n);
    assert.equal(stmt.transactions[1]!.amountCents, 875000n);
  });

  test('não desloca a data por causa do fuso no DTPOSTED', () => {
    // 20260105120000[-3:BRT] tem de continuar sendo dia 05, não dia 04 nem 06.
    assert.equal(stmt.transactions[0]!.postedAt, '2026-01-05');
  });

  test('junta NAME e MEMO quando os dois trazem informação', () => {
    assert.equal(
      stmt.transactions[2]!.description,
      'ALUGUEL · PIX ENVIADO 10/01 IMOBILIARIA CENTRO',
    );
  });

  test('lê o saldo e o período', () => {
    assert.equal(stmt.balanceCents, 1532045n);
    assert.equal(stmt.balanceDate, '2026-01-31');
    assert.equal(stmt.periodStart, '2026-01-01');
    assert.equal(stmt.periodEnd, '2026-01-31');
  });
});

describe('parseOfx — OFX 2.x (XML)', () => {
  const doc = parseOfx(OFX_XML);
  const stmt = doc.statements[0]!;

  test('reconhece fatura de cartão', () => {
    assert.equal(stmt.kind, 'creditcard');
    assert.equal(stmt.accountId, '4111XXXXXXXX1234');
    assert.equal(stmt.transactions.length, 2);
  });

  test('decodifica entidades XML', () => {
    assert.equal(stmt.transactions[1]!.description, 'SPOTIFY & CIA');
  });
});

describe('parseOfx — robustez', () => {
  test('rejeita DOCTYPE/ENTITY (defesa contra XXE)', () => {
    const malicious = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<OFX><STMTRS><STMTTRN><MEMO>&xxe;</MEMO></STMTTRN></STMTRS></OFX>`;
    assert.throws(() => parseOfx(malicious), OfxParseError);
  });

  test('rejeita arquivo que não é OFX', () => {
    assert.throws(() => parseOfx('data,valor\n2026-01-01,10'), OfxParseError);
  });

  test('propaga o erro que o próprio banco devolveu no arquivo', () => {
    const errorFile = `OFXHEADER:100
<OFX><SIGNONMSGSRSV1><SONRS><STATUS>
<CODE>2000<SEVERITY>ERROR<MESSAGE>Conta nao encontrada
</STATUS></SONRS></SIGNONMSGSRSV1></OFX>`;
    assert.throws(() => parseOfx(errorFile), /Conta nao encontrada/);
  });

  test('pula transação sem valor em vez de derrubar o arquivo inteiro', () => {
    const partial = OFX_SGML.replace('<TRNAMT>-127.90\n', '');
    const doc = parseOfx(partial);
    assert.equal(doc.statements[0]!.transactions.length, 2);
    assert.ok(doc.warnings.some((w) => w.includes('ignorada')));
  });

  test('decodifica cp1252 sem produzir caractere de substituição', () => {
    const latin = Buffer.from(OFX_SGML.replace('PADARIA BELA VISTA', 'PADARIA AÇÚCAR'), 'latin1');
    const doc = parseOfx(latin);
    assert.match(doc.statements[0]!.transactions[0]!.description, /AÇÚCAR/);
  });
});

describe('parseOfxDate', () => {
  test('aceita os formatos usados pelos bancos', () => {
    assert.equal(parseOfxDate('20260115'), '2026-01-15');
    assert.equal(parseOfxDate('20260115120000'), '2026-01-15');
    assert.equal(parseOfxDate('20260115120000.000[-3:BRT]'), '2026-01-15');
  });

  test('rejeita data impossível em vez de normalizar em silêncio', () => {
    // new Date(2026, 1, 31) viraria 03/03 e a transação iria para o mês errado.
    assert.equal(parseOfxDate('20260231'), null);
    assert.equal(parseOfxDate('lixo'), null);
    assert.equal(parseOfxDate(null), null);
  });
});

describe('parseAmountToCents', () => {
  test('formato en (ponto decimal)', () => {
    assert.equal(parseAmountToCents('-1234.56'), -123456n);
    assert.equal(parseAmountToCents('1234.5'), 123450n);
  });

  test('formato pt-BR (vírgula decimal, ponto de milhar)', () => {
    assert.equal(parseAmountToCents('-1.234,56'), -123456n);
    assert.equal(parseAmountToCents('1234,56'), 123456n);
    assert.equal(parseAmountToCents('R$ 1.234,56'), 123456n);
  });

  test('notação contábil com parênteses é negativa', () => {
    assert.equal(parseAmountToCents('(1.234,56)'), -123456n);
  });

  test('inteiro sem casa decimal', () => {
    assert.equal(parseAmountToCents('1234'), 123400n);
  });

  test('separador de milhar sozinho não vira decimal', () => {
    // "1.234" é mil duzentos e trinta e quatro, não um e vinte e três.
    assert.equal(parseAmountToCents('1.234'), 123400n);
  });

  test('arredonda a terceira casa decimal em vez de truncar', () => {
    assert.equal(parseAmountToCents('1.234,555'), 123456n);
  });

  test('vírgula com 3 dígitos e nada mais é milhar, não decimal', () => {
    // "10,555" é dez mil quinhentos e cinquenta e cinco nas duas convenções.
    assert.equal(parseAmountToCents('10,555'), 1055500n);
  });

  test('rejeita entrada não numérica', () => {
    assert.throws(() => parseAmountToCents('abc'));
  });
});

describe('normalizeDescription', () => {
  test('remove prefixo de adquirente, data e cidade', () => {
    assert.equal(
      normalizeDescription('PAG*PADARIA BELA VISTA 05/01 SAO PAULO BR'),
      'PADARIA BELA VISTA',
    );
  });

  test('colapsa a mesma compra feita em datas diferentes', () => {
    const a = normalizeDescription('PAG*PADARIA BELA 08/12 SAO PAULO BR');
    const b = normalizeDescription('PAG*PADARIA BELA 15/12 SAO PAULO BR');
    assert.equal(a, b);
  });

  test('remove acento e ruído de PIX', () => {
    assert.equal(normalizeDescription('PIX ENVIADO 10/01 IMOBILIÁRIA CENTRO'), 'IMOBILIARIA CENTRO');
  });

  test('nunca devolve string vazia', () => {
    assert.ok(normalizeDescription('05/01').length > 0);
  });
});

describe('extractInstallment', () => {
  test('reconhece as notações comuns de parcela', () => {
    assert.deepEqual(extractInstallment('NETSHOES 03/12'), { number: 3, total: 12 });
    assert.deepEqual(extractInstallment('PARCELA 2/6'), { number: 2, total: 6 });
    assert.deepEqual(extractInstallment('LOJA X 1 DE 10'), { number: 1, total: 10 });
  });

  test('não confunde parcela com número maior que o total', () => {
    assert.equal(extractInstallment('COMPRA 13/12'), null);
  });
});

describe('buildDedupeHash', () => {
  const base = {
    originId: 'acc-1',
    postedAt: '2026-01-05',
    amountCents: -12790n,
    normalizedDescription: 'PADARIA BELA',
  };

  test('é determinístico', () => {
    assert.equal(buildDedupeHash(base), buildDedupeHash(base));
  });

  test('muda quando a conta de origem muda', () => {
    // A mesma compra no extrato e na fatura são dois eventos distintos.
    assert.notEqual(buildDedupeHash(base), buildDedupeHash({ ...base, originId: 'card-1' }));
  });

  test('permite duas compras idênticas no mesmo dia', () => {
    assert.notEqual(buildDedupeHash(base), buildDedupeHash({ ...base, occurrence: 1 }));
  });
});
