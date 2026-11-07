// The methods the Swarm's lower layers call on higher ones, declared once at the bottom of the chain.
// The layers (server/swarm/*.ts) each extend the one before; `Swarm` (swarm.ts) is the top, and the façade.
import type { Swarm } from '../swarm.ts';
import type { CeoChat } from '../ceoChat.ts';
import type { VoiceKeyView } from '../voice.ts';
import type { PersistedAgent } from './model.ts';

export abstract class SwarmContract {
  protected abstract ceoChat: CeoChat; // the CEO chat's live reply, office calls and threads (swarm.ts)
  // merge.ts
  protected abstract advanceMerges(...a: Parameters<Swarm['advanceMerges']>): ReturnType<Swarm['advanceMerges']>;
  protected abstract askGitHub(...a: Parameters<Swarm['askGitHub']>): ReturnType<Swarm['askGitHub']>;
  protected abstract cleanUpClosed(...a: Parameters<Swarm['cleanUpClosed']>): ReturnType<Swarm['cleanUpClosed']>;
  protected abstract closeResolvedIssues(...a: Parameters<Swarm['closeResolvedIssues']>): ReturnType<Swarm['closeResolvedIssues']>;
  protected abstract learnIssueClosed(...a: Parameters<Swarm['learnIssueClosed']>): ReturnType<Swarm['learnIssueClosed']>;
  protected abstract learnPull(...a: Parameters<Swarm['learnPull']>): ReturnType<Swarm['learnPull']>;
  protected abstract rebaseConflicting(...a: Parameters<Swarm['rebaseConflicting']>): ReturnType<Swarm['rebaseConflicting']>;
  protected abstract refreshPractices(...a: Parameters<Swarm['refreshPractices']>): ReturnType<Swarm['refreshPractices']>;
  protected abstract settleLearned(...a: Parameters<Swarm['settleLearned']>): ReturnType<Swarm['settleLearned']>;
  protected abstract sweepFloor(...a: Parameters<Swarm['sweepFloor']>): ReturnType<Swarm['sweepFloor']>;
  protected abstract syncFolder(...a: Parameters<Swarm['syncFolder']>): ReturnType<Swarm['syncFolder']>;

  // agents.ts
  protected abstract assign(...a: Parameters<Swarm['assign']>): ReturnType<Swarm['assign']>;
  protected abstract boxState(...a: Parameters<Swarm['boxState']>): ReturnType<Swarm['boxState']>;
  protected abstract ensureAgent(...a: Parameters<Swarm['ensureAgent']>): ReturnType<Swarm['ensureAgent']>;
  protected abstract fireAgent(...a: Parameters<Swarm['fireAgent']>): ReturnType<Swarm['fireAgent']>;
  protected abstract port(...a: Parameters<Swarm['port']>): ReturnType<Swarm['port']>;

  // cloudCredit.ts
  protected abstract creditSignIn(...a: Parameters<Swarm['creditSignIn']>): ReturnType<Swarm['creditSignIn']>;
  protected abstract offKey(...a: Parameters<Swarm['offKey']>): ReturnType<Swarm['offKey']>;

  // sessions.ts
  protected abstract clearPrepStrikes(...a: Parameters<Swarm['clearPrepStrikes']>): ReturnType<Swarm['clearPrepStrikes']>;
  protected abstract runTask(...a: Parameters<Swarm['runTask']>): ReturnType<Swarm['runTask']>;
  protected abstract saveTerminals(...a: Parameters<Swarm['saveTerminals']>): ReturnType<Swarm['saveTerminals']>;
  protected abstract startAgentSession(...a: Parameters<Swarm['startAgentSession']>): ReturnType<Swarm['startAgentSession']>;
  protected abstract terminalFor(...a: Parameters<Swarm['terminalFor']>): ReturnType<Swarm['terminalFor']>;

  // qa.ts
  protected abstract onFixFinished(...a: Parameters<Swarm['onFixFinished']>): ReturnType<Swarm['onFixFinished']>;
  protected abstract onQaFinished(...a: Parameters<Swarm['onQaFinished']>): ReturnType<Swarm['onQaFinished']>;
  protected abstract queueQa(...a: Parameters<Swarm['queueQa']>): ReturnType<Swarm['queueQa']>;

  // scheduling.ts
  protected abstract issueFailed(...a: Parameters<Swarm['issueFailed']>): ReturnType<Swarm['issueFailed']>;
  protected abstract limited(...a: Parameters<Swarm['limited']>): ReturnType<Swarm['limited']>;
  protected abstract opsNow(...a: Parameters<Swarm['opsNow']>): ReturnType<Swarm['opsNow']>;
  protected abstract opsSoon(...a: Parameters<Swarm['opsSoon']>): ReturnType<Swarm['opsSoon']>;
  protected abstract paceForWarning(...a: Parameters<Swarm['paceForWarning']>): ReturnType<Swarm['paceForWarning']>;
  protected abstract pauseForLimit(...a: Parameters<Swarm['pauseForLimit']>): ReturnType<Swarm['pauseForLimit']>;
  protected abstract recordSync(...a: Parameters<Swarm['recordSync']>): ReturnType<Swarm['recordSync']>;
  protected abstract recordUsage(...a: Parameters<Swarm['recordUsage']>): ReturnType<Swarm['recordUsage']>;
  protected abstract schedule(...a: Parameters<Swarm['schedule']>): ReturnType<Swarm['schedule']>;
  protected abstract usageNow(...a: Parameters<Swarm['usageNow']>): ReturnType<Swarm['usageNow']>;

  // update.ts
  protected abstract officeUpdateTick(...a: Parameters<Swarm['officeUpdateTick']>): ReturnType<Swarm['officeUpdateTick']>;
  protected abstract officeUpdateView(...a: Parameters<Swarm['officeUpdateView']>): ReturnType<Swarm['officeUpdateView']>;
  protected abstract setOfficeBehind(...a: Parameters<Swarm['setOfficeBehind']>): ReturnType<Swarm['setOfficeBehind']>;

  // reactions.ts (protected there)
  protected abstract markQuiet(messageIds: number[]): void;

  // voices.ts (protected there)
  protected abstract voiceKeyChanged(view: VoiceKeyView): void;
  protected abstract voiceEveryone(): Promise<void>;
  protected abstract setAgentVoice(a: PersistedAgent, patch: { voiceId?: unknown; voiceName?: unknown }): void;

  // ceoJobs.ts
  protected abstract ceo(...a: Parameters<Swarm['ceo']>): ReturnType<Swarm['ceo']>;
  protected abstract ceoInfo(...a: Parameters<Swarm['ceoInfo']>): ReturnType<Swarm['ceoInfo']>;
  protected abstract chatView(...a: Parameters<Swarm['chatView']>): ReturnType<Swarm['chatView']>;
  protected abstract ceoPromptInput(...a: Parameters<Swarm['ceoPromptInput']>): ReturnType<Swarm['ceoPromptInput']>;
  protected abstract decideFromTelegram(...a: Parameters<Swarm['decideFromTelegram']>): ReturnType<Swarm['decideFromTelegram']>;
  protected abstract emitCeo(...a: Parameters<Swarm['emitCeo']>): ReturnType<Swarm['emitCeo']>;
  protected abstract enqueueCeo(...a: Parameters<Swarm['enqueueCeo']>): ReturnType<Swarm['enqueueCeo']>;
  protected abstract ensureCeo(...a: Parameters<Swarm['ensureCeo']>): ReturnType<Swarm['ensureCeo']>;
  protected abstract floorName(...a: Parameters<Swarm['floorName']>): ReturnType<Swarm['floorName']>;
  protected abstract followup(...a: Parameters<Swarm['followup']>): ReturnType<Swarm['followup']>;
  protected abstract maybeFollowup(...a: Parameters<Swarm['maybeFollowup']>): ReturnType<Swarm['maybeFollowup']>;
  protected abstract maybeHeartbeat(...a: Parameters<Swarm['maybeHeartbeat']>): ReturnType<Swarm['maybeHeartbeat']>;
  protected abstract messageCeo(...a: Parameters<Swarm['messageCeo']>): ReturnType<Swarm['messageCeo']>;
  protected abstract mirrorsToTelegram(...a: Parameters<Swarm['mirrorsToTelegram']>): ReturnType<Swarm['mirrorsToTelegram']>;
  protected abstract notifyMerge(...a: Parameters<Swarm['notifyMerge']>): ReturnType<Swarm['notifyMerge']>;
  protected abstract notifyNeedsHuman(...a: Parameters<Swarm['notifyNeedsHuman']>): ReturnType<Swarm['notifyNeedsHuman']>;
  protected abstract postMessage(...a: Parameters<Swarm['postMessage']>): ReturnType<Swarm['postMessage']>;
  protected abstract startCeoWork(...a: Parameters<Swarm['startCeoWork']>): ReturnType<Swarm['startCeoWork']>;
  protected abstract stuck(...a: Parameters<Swarm['stuck']>): ReturnType<Swarm['stuck']>;
  protected abstract triageJob(...a: Parameters<Swarm['triageJob']>): ReturnType<Swarm['triageJob']>;

  // upkeep.ts
  protected abstract careerWork(...a: Parameters<Swarm['careerWork']>): ReturnType<Swarm['careerWork']>;
  protected abstract doctorView(...a: Parameters<Swarm['doctorView']>): ReturnType<Swarm['doctorView']>;
  protected abstract ledger(...a: Parameters<Swarm['ledger']>): ReturnType<Swarm['ledger']>;
  protected abstract prAuthor(...a: Parameters<Swarm['prAuthor']>): ReturnType<Swarm['prAuthor']>;
  protected abstract progressTick(...a: Parameters<Swarm['progressTick']>): ReturnType<Swarm['progressTick']>;
  protected abstract progressView(...a: Parameters<Swarm['progressView']>): ReturnType<Swarm['progressView']>;
  protected abstract restoreDesk(...a: Parameters<Swarm['restoreDesk']>): ReturnType<Swarm['restoreDesk']>;

  // team.ts
  protected abstract applyTeamChanges(...a: Parameters<Swarm['applyTeamChanges']>): ReturnType<Swarm['applyTeamChanges']>;
  protected abstract approveRequest(...a: Parameters<Swarm['approveRequest']>): ReturnType<Swarm['approveRequest']>;
  protected abstract decide(...a: Parameters<Swarm['decide']>): ReturnType<Swarm['decide']>;
  protected abstract rejectRequest(...a: Parameters<Swarm['rejectRequest']>): ReturnType<Swarm['rejectRequest']>;

  // ceoTools.ts
  protected abstract agentDoing(...a: Parameters<Swarm['agentDoing']>): ReturnType<Swarm['agentDoing']>;
  protected abstract ask(...a: Parameters<Swarm['ask']>): ReturnType<Swarm['ask']>;
  protected abstract dropQuestion(...a: Parameters<Swarm['dropQuestion']>): ReturnType<Swarm['dropQuestion']>;
  protected abstract floorRepo(...a: Parameters<Swarm['floorRepo']>): ReturnType<Swarm['floorRepo']>;
  protected abstract managerAnswer(...a: Parameters<Swarm['managerAnswer']>): ReturnType<Swarm['managerAnswer']>;
  protected abstract maybeChanges(...a: Parameters<Swarm['maybeChanges']>): ReturnType<Swarm['maybeChanges']>;
  protected abstract notifyQuestion(...a: Parameters<Swarm['notifyQuestion']>): ReturnType<Swarm['notifyQuestion']>;
  protected abstract officeTools(...a: Parameters<Swarm['officeTools']>): ReturnType<Swarm['officeTools']>;
  protected abstract settleChanges(...a: Parameters<Swarm['settleChanges']>): ReturnType<Swarm['settleChanges']>;
  protected abstract takeChanges(...a: Parameters<Swarm['takeChanges']>): ReturnType<Swarm['takeChanges']>;

  // sessions.ts
  protected abstract closeTestLab(...a: Parameters<Swarm['closeTestLab']>): ReturnType<Swarm['closeTestLab']>;
  protected abstract labSessions(...a: Parameters<Swarm['labSessions']>): ReturnType<Swarm['labSessions']>;
  protected abstract labView(...a: Parameters<Swarm['labView']>): ReturnType<Swarm['labView']>;

  // swarm.ts
  protected abstract finishRestart(...a: Parameters<Swarm['finishRestart']>): ReturnType<Swarm['finishRestart']>;
  protected abstract message(...a: Parameters<Swarm['message']>): ReturnType<Swarm['message']>;
  protected abstract reconcileRestart(...a: Parameters<Swarm['reconcileRestart']>): ReturnType<Swarm['reconcileRestart']>;
  protected abstract recover(...a: Parameters<Swarm['recover']>): ReturnType<Swarm['recover']>;
  protected abstract updateSettings(...a: Parameters<Swarm['updateSettings']>): ReturnType<Swarm['updateSettings']>;
}
