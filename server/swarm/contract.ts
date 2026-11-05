// The methods the Swarm's lower layers call on higher ones, declared once at the bottom of the chain.
// The layers (server/swarm/*.ts) each extend the one before; `Swarm` (swarm.ts) is the top, and the façade.
import type { Swarm } from '../swarm.ts';

export abstract class SwarmContract {
  // swarm.ts
  protected abstract boxState(...a: Parameters<Swarm['boxState']>): ReturnType<Swarm['boxState']>;
  protected abstract ceoInfo(...a: Parameters<Swarm['ceoInfo']>): ReturnType<Swarm['ceoInfo']>;
  protected abstract decideFromTelegram(...a: Parameters<Swarm['decideFromTelegram']>): ReturnType<Swarm['decideFromTelegram']>;
  protected abstract doctorView(...a: Parameters<Swarm['doctorView']>): ReturnType<Swarm['doctorView']>;
  protected abstract ledger(...a: Parameters<Swarm['ledger']>): ReturnType<Swarm['ledger']>;
  protected abstract limited(...a: Parameters<Swarm['limited']>): ReturnType<Swarm['limited']>;
  protected abstract messageCeo(...a: Parameters<Swarm['messageCeo']>): ReturnType<Swarm['messageCeo']>;
  protected abstract mirrorsToTelegram(...a: Parameters<Swarm['mirrorsToTelegram']>): ReturnType<Swarm['mirrorsToTelegram']>;
  protected abstract notifyNeedsHuman(...a: Parameters<Swarm['notifyNeedsHuman']>): ReturnType<Swarm['notifyNeedsHuman']>;
  protected abstract officeUpdateView(...a: Parameters<Swarm['officeUpdateView']>): ReturnType<Swarm['officeUpdateView']>;
  protected abstract opsNow(...a: Parameters<Swarm['opsNow']>): ReturnType<Swarm['opsNow']>;
  protected abstract opsSoon(...a: Parameters<Swarm['opsSoon']>): ReturnType<Swarm['opsSoon']>;
  protected abstract port(...a: Parameters<Swarm['port']>): ReturnType<Swarm['port']>;
  protected abstract postMessage(...a: Parameters<Swarm['postMessage']>): ReturnType<Swarm['postMessage']>;
  protected abstract progressView(...a: Parameters<Swarm['progressView']>): ReturnType<Swarm['progressView']>;
  protected abstract triageJob(...a: Parameters<Swarm['triageJob']>): ReturnType<Swarm['triageJob']>;
  protected abstract usageNow(...a: Parameters<Swarm['usageNow']>): ReturnType<Swarm['usageNow']>;
}
