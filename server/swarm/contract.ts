// The methods the Swarm's lower layers call on higher ones, declared once at the bottom of the chain.
// The layers (server/swarm/*.ts) each extend the one before; `Swarm` (swarm.ts) is the top, and the façade.
import type { Swarm } from '../swarm.ts';
import type { CeoChat } from '../ceoChat.ts';
import type { VoiceKeyView } from '../voice.ts';
import type { AgentCli, UseCase } from '../../shared/types.ts';
import type { PersistedAgent, PersistedRepo } from './model.ts';

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
  protected abstract recheckStuck(...a: Parameters<Swarm['recheckStuck']>): ReturnType<Swarm['recheckStuck']>;
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

  // providers.ts
  protected abstract recheckClis(): void;

  // cloudCredit.ts
  protected abstract creditSignIn(...a: Parameters<Swarm['creditSignIn']>): ReturnType<Swarm['creditSignIn']>;
  protected abstract offKey(...a: Parameters<Swarm['offKey']>): ReturnType<Swarm['offKey']>;

  // rotation.ts (protected there)
  protected abstract runningTaskAccounts(): string[];

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
  protected abstract usageSharesSoon(...a: Parameters<Swarm['usageSharesSoon']>): ReturnType<Swarm['usageSharesSoon']>;

  // update.ts
  protected abstract labGateNow(...a: Parameters<Swarm['labGateNow']>): ReturnType<Swarm['labGateNow']>;
  protected abstract officeUpdateTick(...a: Parameters<Swarm['officeUpdateTick']>): ReturnType<Swarm['officeUpdateTick']>;
  protected abstract officeUpdateView(...a: Parameters<Swarm['officeUpdateView']>): ReturnType<Swarm['officeUpdateView']>;
  protected abstract setOfficeBehind(...a: Parameters<Swarm['setOfficeBehind']>): ReturnType<Swarm['setOfficeBehind']>;

  // setup.ts (protected there)
  protected abstract setupBlocks(agentId: string): boolean;
  protected abstract floorSetupLine(r: PersistedRepo): string;
  protected abstract ceoApplySetup(x: { floor: number; use_case?: UseCase; gap?: string }): string;

  // reactions.ts (protected there)
  protected abstract markQuiet(messageIds: number[]): void;

  // voices.ts (protected there)
  protected abstract voiceKeyChanged(view: VoiceKeyView): void;
  protected abstract voiceEveryone(): Promise<void>;
  protected abstract setAgentVoice(a: PersistedAgent, patch: { voiceId?: unknown; voiceName?: unknown }): void;

  // ceoModels.ts (protected there)
  protected abstract ceoCliOf(a: PersistedAgent): AgentCli;

  // ceoJobs.ts
  protected abstract ceoTold: string[]; // for the CEO's next job
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
  protected abstract stuckRecord(...a: Parameters<Swarm['stuckRecord']>): ReturnType<Swarm['stuckRecord']>;
  protected abstract triageJob(...a: Parameters<Swarm['triageJob']>): ReturnType<Swarm['triageJob']>;

  // ceoStuck.ts
  protected abstract startCeoSession(...a: Parameters<Swarm['startCeoSession']>): ReturnType<Swarm['startCeoSession']>;

  // upkeep.ts
  protected abstract alertBlocked(...a: Parameters<Swarm['alertBlocked']>): ReturnType<Swarm['alertBlocked']>;
  protected abstract careerWork(...a: Parameters<Swarm['careerWork']>): ReturnType<Swarm['careerWork']>;
  protected abstract doctorView(...a: Parameters<Swarm['doctorView']>): ReturnType<Swarm['doctorView']>;
  protected abstract ledger(...a: Parameters<Swarm['ledger']>): ReturnType<Swarm['ledger']>;
  protected abstract prAuthor(...a: Parameters<Swarm['prAuthor']>): ReturnType<Swarm['prAuthor']>;
  protected abstract progressTick(...a: Parameters<Swarm['progressTick']>): ReturnType<Swarm['progressTick']>;
  protected abstract progressView(...a: Parameters<Swarm['progressView']>): ReturnType<Swarm['progressView']>;
  protected abstract restoreDesk(...a: Parameters<Swarm['restoreDesk']>): ReturnType<Swarm['restoreDesk']>;
  protected abstract requeue(a: PersistedAgent, why: string): void; // protected there

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

  // itDept.ts
  protected abstract itBotSecret(...a: Parameters<Swarm['itBotSecret']>): ReturnType<Swarm['itBotSecret']>;
  protected abstract askIt(...a: Parameters<Swarm['askIt']>): ReturnType<Swarm['askIt']>;
  protected abstract itDecide(...a: Parameters<Swarm['itDecide']>): ReturnType<Swarm['itDecide']>;
  protected abstract itProposed(...a: Parameters<Swarm['itProposed']>): ReturnType<Swarm['itProposed']>;
  protected abstract itRan(...a: Parameters<Swarm['itRan']>): ReturnType<Swarm['itRan']>;

  // itTickets.ts
  protected abstract autoTicket(...a: Parameters<Swarm['autoTicket']>): ReturnType<Swarm['autoTicket']>;
  protected abstract itReport(...a: Parameters<Swarm['itReport']>): ReturnType<Swarm['itReport']>;
  protected abstract itTicket(...a: Parameters<Swarm['itTicket']>): ReturnType<Swarm['itTicket']>;

  // itImprove.ts
  protected abstract itImprove(...a: Parameters<Swarm['itImprove']>): ReturnType<Swarm['itImprove']>;
  protected abstract itReview(...a: Parameters<Swarm['itReview']>): ReturnType<Swarm['itReview']>;
  protected abstract recordTickets(...a: Parameters<Swarm['recordTickets']>): ReturnType<Swarm['recordTickets']>;
  // problems.ts
  protected abstract noteProblem(...a: Parameters<Swarm['noteProblem']>): ReturnType<Swarm['noteProblem']>;
  protected abstract problemSession(...a: Parameters<Swarm['problemSession']>): ReturnType<Swarm['problemSession']>;
  protected abstract problemsList(...a: Parameters<Swarm['problemsList']>): ReturnType<Swarm['problemsList']>;

  // itWatch.ts
  protected abstract itRecommend(...a: Parameters<Swarm['itRecommend']>): ReturnType<Swarm['itRecommend']>;

  // sessions.ts
  protected abstract closeTestLab(...a: Parameters<Swarm['closeTestLab']>): ReturnType<Swarm['closeTestLab']>;
  protected abstract labSessions(...a: Parameters<Swarm['labSessions']>): ReturnType<Swarm['labSessions']>;
  protected abstract labView(...a: Parameters<Swarm['labView']>): ReturnType<Swarm['labView']>;

  // upkeep.ts
  protected abstract hybridHost(...a: Parameters<Swarm['hybridHost']>): ReturnType<Swarm['hybridHost']>;

  // swarm.ts
  protected abstract finishRestart(...a: Parameters<Swarm['finishRestart']>): ReturnType<Swarm['finishRestart']>;
  protected abstract message(...a: Parameters<Swarm['message']>): ReturnType<Swarm['message']>;
  protected abstract reconcileRestart(...a: Parameters<Swarm['reconcileRestart']>): ReturnType<Swarm['reconcileRestart']>;
  protected abstract recover(...a: Parameters<Swarm['recover']>): ReturnType<Swarm['recover']>;
  protected abstract updateSettings(...a: Parameters<Swarm['updateSettings']>): ReturnType<Swarm['updateSettings']>;
}
