/**
 * Hand-built statement fixtures in the shape MetaTrader writes (attributes,
 * colspans, nbsp, "10 000.00" thousands). Test-only.
 */

export const MT4_DETAILED = `<html><head><title>Statement: 1234567</title></head><body>
<div align=center><b>Demo Broker Ltd.</b><br></div>
<table cellspacing=1 cellpadding=3 border=0>
<tr align=left><td colspan=2><b>Account: 1234567</b></td><td colspan=5><b>Name: Test Trader</b></td><td colspan=2><b>Currency: USD</b></td><td colspan=2><b>Leverage: 1:100</b></td><td colspan=3 align=right><b>2026 March 10, 23:59</b></td></tr>
<tr align=left><td colspan=13><b>Closed Transactions:</b></td></tr>
<tr align=center bgcolor="#C0C0C0"><td>Ticket</td><td nowrap>Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S&nbsp;/&nbsp;L</td><td>T&nbsp;/&nbsp;P</td><td nowrap>Close Time</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>
<tr align=right><td>50000001</td><td class=msdate nowrap>2026.03.02 09:00:00</td><td>balance</td><td colspan=10 align=left>Deposit</td><td class=mspt>10&nbsp;000.00</td></tr>
<tr bgcolor=#FFFFFF align=right><td title="#123">50000002</td><td class=msdate nowrap>2026.03.04 15:30:00</td><td>buy</td><td class=mspt>1.00</td><td>eurusd</td><td style="mso-number-format:0\\.00000;">1.10000</td><td style="mso-number-format:0\\.00000;">1.09900</td><td style="mso-number-format:0\\.00000;">0.00000</td><td class=msdate nowrap>2026.03.04 17:00:00</td><td style="mso-number-format:0\\.00000;">1.10200</td><td class=mspt>-7.00</td><td class=mspt>-0.50</td><td class=mspt>-1.20</td><td class=mspt>200.00</td></tr>
<tr bgcolor=#E0E0E0 align=right><td>50000003</td><td class=msdate nowrap>2026.03.05 10:00:00</td><td>sell</td><td class=mspt>0.50</td><td>EURJPY.m</td><td>163.500</td><td>164.000</td><td>162.500</td><td class=msdate nowrap>2026.03.05 12:00:00</td><td>162.900</td><td class=mspt>0.00</td><td class=mspt>0.00</td><td class=mspt>0.00</td><td class=mspt>201.34</td></tr>
<tr bgcolor=#FFFFFF align=right><td>50000004</td><td class=msdate nowrap>2026.03.06 08:00:00</td><td>buy limit</td><td class=mspt>1.00</td><td>gbpusd</td><td>1.27000</td><td>0.00000</td><td>0.00000</td><td class=msdate nowrap>2026.03.06 20:00:00</td><td>1.27500</td><td colspan=4 align=right>cancelled</td></tr>
<tr align=right><td colspan=10>&nbsp;</td><td class=mspt>-7.00</td><td class=mspt>-0.50</td><td class=mspt>-1.20</td><td class=mspt>401.34</td></tr>
<tr align=left><td colspan=13><b>Open Trades:</b></td></tr>
<tr align=center bgcolor="#C0C0C0"><td>Ticket</td><td nowrap>Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S&nbsp;/&nbsp;L</td><td>T&nbsp;/&nbsp;P</td><td nowrap>&nbsp;</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>
<tr bgcolor=#FFFFFF align=right><td>50000005</td><td class=msdate nowrap>2026.03.10 11:00:00</td><td>sell</td><td class=mspt>2.00</td><td>XAUUSD</td><td>2950.50</td><td>2960.00</td><td>0.00</td><td>&nbsp;</td><td>2948.10</td><td class=mspt>0.00</td><td class=mspt>0.00</td><td class=mspt>0.00</td><td class=mspt>480.00</td></tr>
<tr align=left><td colspan=13><b>Working Orders:</b></td></tr>
<tr align=center bgcolor="#C0C0C0"><td>Ticket</td><td nowrap>Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S&nbsp;/&nbsp;L</td><td>T&nbsp;/&nbsp;P</td><td colspan=2>Market Price</td><td colspan=4>&nbsp;</td></tr>
<tr bgcolor=#FFFFFF align=right><td>50000006</td><td class=msdate nowrap>2026.03.10 12:00:00</td><td>sell stop</td><td class=mspt>1.00</td><td>usdjpy</td><td>148.000</td><td>0.000</td><td>0.000</td><td colspan=2>148.900</td><td colspan=4>&nbsp;</td></tr>
</table></body></html>`;

export const MT5_REPORT = `<!DOCTYPE html><html><head><title>Trade History Report</title></head><body>
<table cellspacing="1" cellpadding="3" border="0">
<tr align="center"><td colspan="13"><div style="font: 14pt Tahoma"><b>Trade History Report</b></div></td></tr>
<tr align="left"><th colspan="3" nowrap align="right">Name:</th><th colspan="10" nowrap align="left"><b>Test Trader</b></th></tr>
<tr align="left"><th colspan="3" nowrap align="right">Account:</th><th colspan="10" nowrap align="left"><b>87654321&nbsp;(USD, Demo Broker-Server, demo, Hedge)</b></th></tr>
<tr align="center"><th colspan="13" height="25"><div style="font: 10pt Tahoma"><b>Positions</b></div></th></tr>
<tr align="center" bgcolor="#E5F0FC"><td nowrap><b>Time</b></td><td nowrap><b>Position</b></td><td nowrap><b>Symbol</b></td><td nowrap><b>Type</b></td><td nowrap><b>Volume</b></td><td nowrap><b>Price</b></td><td nowrap><b>S / L</b></td><td nowrap><b>T / P</b></td><td nowrap><b>Time</b></td><td nowrap><b>Price</b></td><td nowrap><b>Commission</b></td><td nowrap><b>Swap</b></td><td nowrap><b>Profit</b></td></tr>
<tr bgcolor="#FFFFFF" align="right"><td>2026.07.14 10:00:00</td><td>9000001</td><td>USDJPY</td><td>sell</td><td>1</td><td>148.500</td><td>149.000</td><td></td><td>2026.07.14 18:30:15</td><td>148.000</td><td>-6.00</td><td>-2.10</td><td>337.84</td></tr>
<tr bgcolor="#F7F7F7" align="right"><td>2026.07.15 09:15:00</td><td>9000002</td><td>NAS100</td><td>buy</td><td>0.5</td><td>19 500.0</td><td>19 450.0</td><td>19 600.0</td><td>2026.07.15 11:00:00</td><td>19 560.0</td><td>0.00</td><td>0.00</td><td>3 000.00</td></tr>
<tr align="right"><td colspan="10"></td><td>-6.00</td><td>-2.10</td><td>3 337.84</td></tr>
<tr align="center"><th colspan="13" height="25"><div style="font: 10pt Tahoma"><b>Orders</b></div></th></tr>
<tr align="center" bgcolor="#E5F0FC"><td nowrap><b>Open Time</b></td><td nowrap><b>Order</b></td><td nowrap><b>Symbol</b></td><td nowrap><b>Type</b></td><td colspan="2"><b>Volume</b></td><td><b>Price</b></td><td><b>S / L</b></td><td><b>T / P</b></td><td><b>Time</b></td><td><b>State</b></td><td colspan="2"><b>Comment</b></td></tr>
<tr bgcolor="#FFFFFF" align="right"><td>2026.07.14 10:00:00</td><td>7000001</td><td>USDJPY</td><td>sell</td><td colspan="2">1 / 1</td><td>148.500</td><td>149.000</td><td></td><td>2026.07.14 10:00:00</td><td>filled</td><td colspan="2"></td></tr>
<tr align="center"><th colspan="13" height="25"><div style="font: 10pt Tahoma"><b>Deals</b></div></th></tr>
<tr align="center" bgcolor="#E5F0FC"><td nowrap><b>Time</b></td><td nowrap><b>Deal</b></td><td nowrap><b>Symbol</b></td><td nowrap><b>Type</b></td><td nowrap><b>Direction</b></td><td nowrap><b>Volume</b></td><td nowrap><b>Price</b></td><td nowrap><b>Order</b></td><td nowrap><b>Commission</b></td><td nowrap><b>Fee</b></td><td nowrap><b>Swap</b></td><td nowrap><b>Profit</b></td><td nowrap><b>Balance</b></td><td nowrap><b>Comment</b></td></tr>
<tr bgcolor="#FFFFFF" align="right"><td>2026.07.01 08:00:00</td><td>8000001</td><td></td><td>balance</td><td></td><td></td><td></td><td></td><td>0.00</td><td>0.00</td><td>0.00</td><td>25 000.00</td><td>25 000.00</td><td>Deposit</td></tr>
<tr bgcolor="#F7F7F7" align="right"><td>2026.07.20 08:00:00</td><td>8000099</td><td></td><td>balance</td><td></td><td></td><td></td><td></td><td>0.00</td><td>0.00</td><td>0.00</td><td>-1 000.00</td><td>27 337.84</td><td>Withdrawal</td></tr>
<tr align="center"><th colspan="13" height="25"><div style="font: 10pt Tahoma"><b>Open Positions</b></div></th></tr>
<tr align="center" bgcolor="#E5F0FC"><td nowrap><b>Time</b></td><td nowrap><b>Position</b></td><td nowrap><b>Symbol</b></td><td nowrap><b>Type</b></td><td nowrap><b>Volume</b></td><td nowrap><b>Price</b></td><td nowrap><b>S / L</b></td><td nowrap><b>T / P</b></td><td nowrap><b>Market Price</b></td><td nowrap><b>Swap</b></td><td nowrap><b>Profit</b></td><td colspan="2"><b>Comment</b></td></tr>
<tr bgcolor="#FFFFFF" align="right"><td>2026.07.21 13:00:00</td><td>9000003</td><td>EURUSD</td><td>buy</td><td>0.2</td><td>1.16000</td><td>1.15500</td><td>1.17000</td><td>1.16100</td><td>0.00</td><td>20.00</td><td colspan="2"></td></tr>
<tr align="center"><th colspan="13" height="25"><div style="font: 10pt Tahoma"><b>Results</b></div></th></tr>
</table></body></html>`;

/** UTF-16LE with a BOM, which is how MT5 actually writes the file. */
export function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[2 + i * 2] = c & 0xff;
    out[3 + i * 2] = c >> 8;
  }
  return out;
}
