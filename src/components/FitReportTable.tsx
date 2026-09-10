/* v3-67 §1 — **핏 리포트 «표시» 층**. V3Panel 이 쓰던 마크업을 **그대로 옮겨** 제품 화면과 «공유»한다.
 *
 * **표 «계산» 채널 0줄** — 값은 전부 워커의 `fitReport.ts` 가 낸 `FitReportResult` 를 «읽기»만 한다.
 * 자릿수·분기점·문언은 **v3-52 / v3-54 정본 형식 그대로**다(옮기면서 한 글자도 바꾸지 않았다).
 * 이 파일이 생긴 이유는 **재사용**이다 — 같은 표를 두 벌 쓰지 않기 위해서고,
 * 그래서 V3Panel 은 이 컴포넌트를 부르도록 바뀐다(마크업 동일 ⟹ 하네스 렌더 불변).
 */
import type { FitReportResult } from "../v3/fitReport.ts";

/** G5 — 범례가 «분기점 값»을 스스로 밝힌다. 여유 상한은 **그 상태의 p95**(표시 층 절단). */
export function FitLegend({ fit }: { fit: FitReportResult }) {
  return (
    <>
      <span className="rounded px-1" style={{ background: "rgb(230,45,60)", color: "#fff" }}>눌림 &lt;0</span>
      <span className="rounded px-1" style={{ background: "rgb(250,168,50)" }}>밀착 0~{fit.sepMm.toFixed(1)}mm</span>
      <span className="rounded px-1" style={{ background: "rgb(70,150,230)", color: "#fff" }}>
        여유 {fit.sepMm.toFixed(1)}~{fit.color.looseTopMm.toFixed(1)}mm(p95)
      </span>
      <span className="opacity-70">눌림 하한 {fit.color.penFloorMm.toFixed(1)}mm(게이트 ③a 문턱)</span>
    </>
  );
}

export function FitReportTable({ fit }: { fit: FitReportResult }) {
  return (
    <div className="mt-2 border-t pt-2 text-[11px]">
      <div>
        핏 리포트 — 옷↔몸 부호거리(mm) · 경계 <b>{fit.sepMm.toFixed(1)}mm</b>
        <span className="opacity-70"> ({fit.sepDerivation})</span>
      </div>
      <div className="opacity-70">
        대역 반폭 <b>{fit.bandHalfMm.toFixed(1)}mm</b> — {fit.bandDerivation} · 가슴 y{fit.levels.chestYCm.toFixed(2)}cm(둘레 {fit.levels.cChestCm.toFixed(2)}cm) · 허리 y{fit.levels.waistYCm.toFixed(2)}cm(둘레 {fit.levels.cWaistCm.toFixed(2)}cm) · 겨드랑이 y{fit.levels.yArmCm.toFixed(2)}cm
      </div>
      <table className="mt-1 w-full">
        <thead className="opacity-70">
          <tr><th className="text-left">부위</th><th className="text-right">중앙</th><th className="text-right">p25~p75</th><th className="text-left">판정</th><th className="text-left">눌림/밀착/여유</th></tr>
        </thead>
        <tbody>
          {fit.rows.map((r) => {
            const l = !Number.isFinite(r.medMm) ? ["산출 불가", "opacity-50"]
              : r.medMm < 0 ? ["눌림", "text-rose-600"]
              : r.medMm <= fit.sepMm ? ["밀착", "text-amber-600"] : ["여유", "text-sky-600"];
            return (
              <tr key={r.name} title={r.domainSpec}>
                <td>{r.name}</td>
                <td className="text-right">{Number.isFinite(r.medMm) ? r.medMm.toFixed(2) : "—"}</td>
                <td className="text-right opacity-70">{Number.isFinite(r.p25Mm) ? `${r.p25Mm.toFixed(2)}~${r.p75Mm.toFixed(2)}` : "—"}</td>
                <td className={l[1]}>{l[0]}</td>
                <td className="opacity-70">{r.pressN} / {r.snugN} / {r.looseN} <span className="opacity-60">(표본 {r.n}/{r.domain})</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-1 opacity-70">
        자기검사 — 리포트 층 c ↔ 게이트 정확 거리: 표본 <b>{fit.self.n}</b> · 최대차{" "}
        <b>{fit.self.maxDiffMm.toFixed(3)}mm</b> · 부호 일치율 <b>{fit.self.signAgreePct.toFixed(2)}%</b>
        <span className="opacity-60"> · 정의역 {fit.self.domain}</span>
        <div>
          {/* v3-80 §1-④ — 라벨의 «비율»도 결과에서 읽는다. 손으로 적힌 「5%」는 v3-54 정정 «전» 값이었다. */}
          등재 잡음(h의 {(fit.self.noiseFrac * 100).toFixed(0)}%) <b>{fit.self.noiseMm.toFixed(3)}mm</b> · 초과 표본{" "}
          <b>{fit.self.overNoise}/{fit.self.n}</b> · 밴드 상한 <b>{fit.bandMm.toFixed(3)}mm</b>
          {fit.self.maxDiffMm > fit.self.noiseMm && <b className="text-rose-600"> — 등재 잡음 초과</b>}
        </div>
      </div>
    </div>
  );
}
