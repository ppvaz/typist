// A benchmark set's result: medians (accuracy first), each trial's joint pass
// at the relevant gate, and the gate decision with its actual missing
// conditions. Medians alone never manufacture a pass.
import { type Gate, type MilestoneEvaluation, qualify, type SetEvaluation, trialWpm } from '../../domain/evidence';
import { wpmMeets } from '../../domain/scoring/rational';
import { Fraction } from '../../domain/scoring/fraction';
import { accuracyOf, fractionAccuracy, fractionWpm, glancesLabel, rawWpmOf, timeOfDay, wpmOf } from '../format';
import { Message, StatusMark } from './basics';

function gateName(gate: Gate): string {
  switch (gate.kind) {
    case 'advance':
      return 'Stage gate (advance)';
    case 'acquired':
      return 'Acquisition';
    case 'strong':
      return 'Strong';
    default:
      return gate.label ? `Showcase: ${gate.label}` : 'Showcase';
  }
}

/** "Speed was 1.2 WPM short of 20 on two of the three trials." */
function shortfall(evaluation: SetEvaluation, gate: Gate): string | null {
  const threshold = Fraction.decimal(gate.wpm);
  const short = evaluation.contributing.filter((t) => !wpmMeets(t.counters.finalCorrect, t.activeMs ?? 0, gate.wpm));
  if (short.length < 2) return null;
  const gaps = short.map((t) => threshold.sub(trialWpm(t) ?? Fraction.ZERO));
  const smallest = gaps.sort((a, b) => a.compare(b))[0];
  return `Speed was ${smallest?.format(1)} WPM or more short of ${gate.wpm} on ${short.length} of the three trials.`;
}

export function SetResult({ evaluation, gate, milestone, timeZone }: { evaluation: SetEvaluation; gate: Gate; milestone: MilestoneEvaluation | null; timeZone?: string }) {
  const result = qualify(evaluation, gate);
  const eligibility = !evaluation.complete ? 'Incomplete' : evaluation.excluded ? 'Excluded · other hand' : !evaluation.declarationsAnswered ? 'Pending declarations' : evaluation.noLook.status === 'pass' ? 'Eligible · no-look' : evaluation.noLook.status === 'pending' ? 'Eligible · no-look pending' : 'Measurable · not no-look';
  return (
    <div className="stack-sm">
      <div className="inline-actions" style={{ justifyContent: 'space-between' }}>
        <span className="badge">{eligibility}</span>
        <span className="small muted">
          {gateName(gate)} at {gate.wpm} WPM / {gate.accuracyPercent}% · {evaluation.set.protocolId}
        </span>
      </div>
      <dl className="kv">
        <dt>Median attempt accuracy</dt>
        <dd>
          <strong className="num">{fractionAccuracy(evaluation.medianAccuracy) ?? 'No evidence'}</strong>
          {evaluation.medianAccuracy && '%'} · target {gate.accuracyPercent}
        </dd>
        <dt>Median WPM</dt>
        <dd>
          <strong className="num">{fractionWpm(evaluation.medianWpm) ?? 'No evidence'}</strong> · raw {fractionWpm(evaluation.medianRawWpm) ?? '–'} · target {gate.wpm}
        </dd>
        <dt>Map assistance</dt>
        <dd>{evaluation.contributing.some((t) => t.assistance.revealed || t.assistance.shown.some((s) => s !== 'none')) ? 'Shown during a trial (recorded automatically)' : 'None observed automatically'}</dd>
      </dl>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Trial</th>
              <th className="num">Accuracy</th>
              <th className="num">WPM</th>
              <th className="num">Raw</th>
              <th>Glances</th>
              <th>
                Joint pass at {gate.wpm} / {gate.accuracyPercent}
              </th>
            </tr>
          </thead>
          <tbody>
            {evaluation.attempts.map((t) => {
              const i = evaluation.contributing.indexOf(t);
              const contributes = i >= 0;
              return (
                <tr key={t.id}>
                  <td>
                    {contributes ? i + 1 : '–'} · {timeOfDay(t.startedAt, timeZone)}
                    {!contributes && <span className="small muted"> · {t.status}{t.interruption ? ` (${t.interruption.replace(/-/g, ' ')})` : ''}{t.invalidity.length ? ` (${t.invalidity.join(', ')})` : ''}</span>}
                  </td>
                  <td className="num">{accuracyOf(t) ?? '–'}</td>
                  <td className="num">{wpmOf(t) ?? '–'}</td>
                  <td className="num">{rawWpmOf(t) ?? '–'}</td>
                  <td>{glancesLabel(t.declarations.glances)}</td>
                  <td>{contributes ? (result.perTrial[i] ? <StatusMark mark="met" label="Yes" /> : <StatusMark mark="missed" label="No" />) : 'not counted'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">Two of three trials must pass both thresholds — medians alone cannot manufacture a pass.</p>
      {result.status === 'pass' && (
        <Message kind="met">
          {gate.kind === 'advance'
            ? 'Stage gate met: one qualifying set at 20 WPM and 97%, no looking.'
            : milestone && milestone.award
              ? `${gateName(gate)} awarded.`
              : `The set qualifies. ${Math.max(0, gate.dates - (milestone?.progress ?? 1))} more qualifying session${gate.dates - (milestone?.progress ?? 1) === 1 ? ' is' : 's are'} needed, on separate days.`}
        </Message>
      )}
      {result.status === 'pending' && (
        <Message kind="pending">{result.reasons.map((r) => r.message).join(' ')} Nothing is assumed: the set stays pending until the declaration is complete.</Message>
      )}
      {result.status === 'fail' && (
        <Message kind="short">
          {shortfall(evaluation, gate) ?? ''} {result.reasons.filter((r) => r.code !== 'speed').map((r) => r.message).join(' ')} Nothing is lost — the set stays in history and the next one can be tomorrow.
        </Message>
      )}
    </div>
  );
}
