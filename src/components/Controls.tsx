import { ImageUp, Ruler, Shirt, X } from "lucide-react";
import { useRef, useState } from "react";
import { useFitStore } from "../store/useFitStore";
import { FABRIC_PRESETS, type FabricType } from "../lib/fabricPresets";
import { cropToGarmentRegion } from "../lib/garmentSegmentation";
import { checkGarmentFit } from "../lib/garmentFitLimits";
import { mannequinBonesRef } from "../lib/mannequinRef";
import { PIN_MIN_CLEARANCE } from "../lib/shoulderPin";
import * as THREE from "three";

// P15 §1 — 어깨 관절 좌표 조회용 스크래치(할당 0).
const pinProbeL = new THREE.Vector3();
const pinProbeR = new THREE.Vector3();

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  unit = "cm",
  step = 1,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between text-sm text-slate-300">
        <span>{label}</span>
        <span className="font-mono text-slate-100">
          {step < 1 ? value.toFixed(2) : value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
    </div>
  );
}

export function Controls() {
  const bodySize = useFitStore((s) => s.bodySize);
  const garmentSize = useFitStore((s) => s.garmentSize);
  const setBodyHeight = useFitStore((s) => s.setBodyHeight);
  const setBodyChest = useFitStore((s) => s.setBodyChest);
  const setArmLength = useFitStore((s) => s.setArmLength);
  const setLegLength = useFitStore((s) => s.setLegLength);
  const setShoulderWidth = useFitStore((s) => s.setShoulderWidth);
  const setGarmentLength = useFitStore((s) => s.setGarmentLength);
  const setGarmentWidth = useFitStore((s) => s.setGarmentWidth);
  const setGarmentShoulderWidth = useFitStore((s) => s.setGarmentShoulderWidth);
  const setGarmentSleeveLength = useFitStore((s) => s.setGarmentSleeveLength);
  const setGarmentSleeveWidth = useFitStore((s) => s.setGarmentSleeveWidth);
  const garmentImage = useFitStore((s) => s.garmentImage);
  const setGarmentImage = useFitStore((s) => s.setGarmentImage);
  const fabric = useFitStore((s) => s.fabric);
  const setFabric = useFitStore((s) => s.setFabric);
  const sleeveType = useFitStore((s) => s.sleeveType);
  const setSleeveType = useFitStore((s) => s.setSleeveType);
  const showArmCapsules = useFitStore((s) => s.showArmCapsules);
  const setShowArmCapsules = useFitStore((s) => s.setShowArmCapsules);
  const showFrontWireframe = useFitStore((s) => s.showFrontWireframe);
  const setShowFrontWireframe = useFitStore((s) => s.setShowFrontWireframe);
  const showBackTorsoWireframe = useFitStore((s) => s.showBackTorsoWireframe);
  const setShowBackTorsoWireframe = useFitStore((s) => s.setShowBackTorsoWireframe);
  const showFrontSleeveWireframe = useFitStore((s) => s.showFrontSleeveWireframe);
  const setShowFrontSleeveWireframe = useFitStore((s) => s.setShowFrontSleeveWireframe);
  const showBackSleeveWireframe = useFitStore((s) => s.showBackSleeveWireframe);
  const setShowBackSleeveWireframe = useFitStore((s) => s.setShowBackSleeveWireframe);
  const showAllRegionsWireframe = useFitStore((s) => s.showAllRegionsWireframe);
  const setShowAllRegionsWireframe = useFitStore((s) => s.setShowAllRegionsWireframe);
  const showFitMap = useFitStore((s) => s.showFitMap);
  const setShowFitMap = useFitStore((s) => s.setShowFitMap);
  const renderSmoothing = useFitStore((s) => s.renderSmoothing);
  const setRenderSmoothing = useFitStore((s) => s.setRenderSmoothing);
  const newCore = useFitStore((s) => s.newCore);
  const setNewCore = useFitStore((s) => s.setNewCore);
  const friction = useFitStore((s) => s.friction);
  const setFriction = useFitStore((s) => s.setFriction);
  const fit = checkGarmentFit(bodySize.chest, garmentSize.width);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsProcessingImage(true);
    try {
      // 모델이 옷을 입고 찍은 라이프스타일 사진이면 배경/얼굴을 걷어내고
      // 옷 영역 위주로 잘라낸다(플랫레이 상품샷은 자를 배경이 없어 그대로
      // 반환됨) — garmentSegmentation.ts 참고.
      const url = await cropToGarmentRegion(file);
      setGarmentImage(url);
    } catch {
      // 세그멘테이션이 실패해도 원본 이미지는 그대로 쓸 수 있게 폴백한다.
      setGarmentImage(URL.createObjectURL(file));
    } finally {
      setIsProcessingImage(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-6 overflow-y-auto bg-slate-900 p-6 text-slate-100">
      <h1 className="text-xl font-semibold">Fit Simulator</h1>

      <section className="rounded-xl bg-slate-800/60 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Ruler size={16} />
          <span>Body Size</span>
        </div>
        <Slider label="키" value={bodySize.height} min={140} max={200} onChange={setBodyHeight} />
        <Slider label="가슴둘레" value={bodySize.chest} min={70} max={140} onChange={setBodyChest} />
        <Slider label="팔 길이" value={bodySize.armLength} min={40} max={80} onChange={setArmLength} />
        <Slider label="다리 길이" value={bodySize.legLength} min={60} max={110} onChange={setLegLength} />
        {/* P15 §2 — 옷 쪽에도 「어깨너비」가 있어 화면에서 구별이 안 됐다. 둘 다 꼬리표를 단다. */}
        <Slider
          label="어깨너비(몸)"
          value={bodySize.shoulderWidth}
          min={35}
          max={55}
          onChange={setShoulderWidth}
        />
      </section>

      <section className="rounded-xl bg-slate-800/60 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Shirt size={16} />
          <span>Garment Size</span>
        </div>
        {fit.message && (
          <div
            className={`mb-3 rounded-md px-3 py-2 text-sm ${
              fit.verdict === "impossible" ? "bg-red-950/70 text-red-200 ring-1 ring-red-800" : "bg-amber-950/60 text-amber-200 ring-1 ring-amber-800"
            }`}
          >
            {fit.message}
          </div>
        )}
        <div className="mb-4">
          {/* Safari에서는 hidden input을 <label>로 감싸 클릭을 위임하는 방식이
              신뢰할 수 없어서, ref로 직접 참조해 버튼 클릭 시 .click()을
              호출하는 방식을 쓴다. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="hidden"
          />
          {isProcessingImage ? (
            <div className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-600 py-3 text-sm text-slate-400">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
              <span>옷 영역 분석 중...</span>
            </div>
          ) : garmentImage ? (
            <div className="flex items-center gap-3">
              <img
                src={garmentImage}
                alt="업로드한 옷 이미지"
                className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-700"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 cursor-pointer rounded-md bg-slate-700 px-3 py-1.5 text-center text-sm text-slate-100 hover:bg-slate-600"
              >
                변경
              </button>
              <button
                type="button"
                onClick={() => setGarmentImage(null)}
                className="rounded-md bg-slate-700 p-1.5 text-slate-300 hover:bg-slate-600"
                aria-label="이미지 제거"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-600 py-3 text-sm text-slate-400 hover:border-slate-500 hover:text-slate-300"
            >
              <ImageUp size={16} />
              <span>옷 이미지 업로드</span>
            </button>
          )}
        </div>

        <Slider label="총장" value={garmentSize.length} min={40} max={120} onChange={setGarmentLength} />
        <Slider label="품" value={garmentSize.width} min={35} max={90} onChange={setGarmentWidth} />
        {/* P15 §2 — 「어깨너비(옷)」. 규약: 품·소매통과 달리 **반둘레가 아니라 어깨점 사이
            직선 거리 전체**다(`patternDraft.ts` `shoulderWidthM` 주석). 45cm = 어깨점 간격 45cm. */}
        <Slider
          label="어깨너비(옷)"
          value={garmentSize.shoulderWidth}
          min={30}
          max={70}
          onChange={setGarmentShoulderWidth}
        />
        {/* P15 §1 — **하한 클램프를 화면에 드러낸다.** 어깨 핀은 몸 어깨 «관절» 안으로
            들어갈 수 없어(`computeShoulderPin`의 `PIN_MIN_CLEARANCE`) 그보다 좁은 입력은
            조용히 삼켜진다. 실측: 몸 어깨 45cm에서 하한 37.99cm ⟹ 30~38cm 구간이 죽어 있었다.
            **물리는 한 줄도 안 바꾼다** — 이미 일어나던 일을 «보이게» 할 뿐이다. */}
        {(() => {
          const b = mannequinBonesRef.current;
          if (!b.left || !b.right) return null;
          b.left.updateWorldMatrix(true, false);
          b.right.updateWorldMatrix(true, false);
          b.left.getWorldPosition(pinProbeL);
          b.right.getWorldPosition(pinProbeR);
          const floorCm = 100 * (pinProbeL.distanceTo(pinProbeR) + 2 * PIN_MIN_CLEARANCE);
          if (!(garmentSize.shoulderWidth < floorCm - 1e-6)) return null;
          return (
            <div className="-mt-3 mb-4 text-xs text-amber-300">
              실제 적용 <b>{floorCm.toFixed(1)}cm</b> — 이보다 좁게는 못 준다(어깨 관절 + 여유 1cm).
              더 좁히려면 «어깨너비(몸)»을 줄이세요.
            </div>
          );
        })()}

        <div className="mb-1 text-sm text-slate-300">소매</div>
        <div className="mb-4 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setSleeveType("short")}
            className={`rounded-md px-2 py-1.5 text-xs transition-colors ${
              sleeveType === "short"
                ? "bg-blue-500 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            반팔
          </button>
          <button
            type="button"
            onClick={() => setSleeveType("long")}
            className={`rounded-md px-2 py-1.5 text-xs transition-colors ${
              sleeveType === "long"
                ? "bg-blue-500 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            긴팔
          </button>
        </div>

        <Slider
          label="소매길이"
          value={garmentSize.sleeveLength}
          min={sleeveType === "short" ? 10 : 35}
          max={sleeveType === "short" ? 35 : 75}
          onChange={setGarmentSleeveLength}
        />
        {/* P13 §2 — 라벨을 「소매통」으로 **되돌린다**. P12는 여유가 상수라 슬라이더가
            소맷부리에 도달하지 못해 「(위)」를 달았는데, P13이 여유를 «2·base − 캡 자리 팔»로
            바꾸면서 슬라이더가 소맷부리를 1:1로 지배한다(실측: 10cm→26.36 / 18cm→33.19 /
            35cm→64.34). 다시 소매 전체를 지배하므로 「소매통」이 정확한 이름이다. */}
        <Slider
          label="소매통"
          value={garmentSize.sleeveWidth}
          min={10}
          max={35}
          onChange={setGarmentSleeveWidth}
        />

        <div className="mb-1 text-sm text-slate-300">원단</div>
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(FABRIC_PRESETS) as FabricType[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFabric(key)}
              className={`rounded-md px-2 py-1.5 text-xs transition-colors ${
                fabric === key
                  ? "bg-blue-500 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {FABRIC_PRESETS[key].label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-slate-800/60 p-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={showFitMap}
            onChange={(e) => setShowFitMap(e.target.checked)}
            className="accent-blue-500"
          />
          <span>핏 맵</span>
        </label>
        {showFitMap && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: "#8c00d9" }} />
              관통(디버그)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: "#d92626" }} />
              타이트
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: "#f2d91a" }} />
              적정
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: "#2673f2" }} />
              헐렁
            </span>
          </div>
        )}
      </section>

      {import.meta.env.DEV && (
        <section className="rounded-xl bg-slate-800/60 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showArmCapsules}
              onChange={(e) => setShowArmCapsules(e.target.checked)}
              className="accent-red-500"
            />
            <span>[DEV] 팔 충돌 캡슐 와이어프레임 표시</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showFrontWireframe}
              onChange={(e) => setShowFrontWireframe(e.target.checked)}
              className="accent-red-500"
            />
            <span>[DEV] 앞판 옷감 와이어프레임 표시</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showBackTorsoWireframe}
              onChange={(e) => setShowBackTorsoWireframe(e.target.checked)}
              className="accent-red-500"
            />
            <span>[DEV] 뒤판 몸통 와이어프레임 표시(파랑)</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showFrontSleeveWireframe}
              onChange={(e) => setShowFrontSleeveWireframe(e.target.checked)}
              className="accent-red-500"
            />
            <span>[DEV] 앞판 소매 와이어프레임 표시(빨강)</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showBackSleeveWireframe}
              onChange={(e) => setShowBackSleeveWireframe(e.target.checked)}
              className="accent-red-500"
            />
            <span>[DEV] 뒤판 소매 와이어프레임 표시(주황)</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showAllRegionsWireframe}
              onChange={(e) => setShowAllRegionsWireframe(e.target.checked)}
              className="accent-red-500"
            />
            <span>[DEV] 전 영역 표시(진단용, 텍스처 완전 교체)</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={renderSmoothing}
              onChange={(e) => setRenderSmoothing(e.target.checked)}
              className="accent-red-500"
            />
            <span>[DEV] 렌더 스무딩(서브디비전) — 끄면 물리 격자 해상도 그대로</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={newCore}
              onChange={(e) => setNewCore(e.target.checked)}
              className="accent-red-500"
            />
            <span>[DEV] 신 코어(M1) — 암홀 용접 + 직결 렌더 (신구 대조)</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={friction}
              onChange={(e) => setFriction(e.target.checked)}
              disabled={!newCore}
              className="accent-red-500"
            />
            <span>[DEV] └ SDF 마찰(M2) — 신 코어 켠 상태에서만</span>
          </label>
        </section>
      )}
    </div>
  );
}
