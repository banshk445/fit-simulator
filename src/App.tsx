import { Controls } from "./components/Controls";
import { FitCanvas } from "./components/FitCanvas";
import { DressButton } from "./components/DressButton";

function App() {
  return (
    <div className="flex h-screen w-full">
      <div className="w-[30%] min-w-[280px]">
        <Controls />
      </div>
      <div className="w-[70%] relative">
        <FitCanvas />
        <DressButton />
      </div>
    </div>
  );
}

export default App;
