import {
  Game,
  Scene,
  WebColors,
  GameParameters,
  GameOptions,
  TrialSchema,
  Timer,
  Action,
  Label,
} from "@m2c2kit/core";
import { Session } from "@m2c2kit/session";
import { Button, CountdownScene, Instructions } from "@m2c2kit/addons";

class NBack extends Game {
  constructor() {
    const defaultParameters: GameParameters = {
      n_level: {
        type: "integer",
        default: 2,
        description: "The 'N' in N-Back. Match the letter from N steps ago.",
      },
      stimulus_duration_ms: {
        type: "number",
        default: 500,
        description: "How long the letter remains visible (ms).",
      },
      trial_duration_ms: {
        type: "number",
        default: 2000,
        description: "Total duration of one trial (stimulus + wait for input).",
      },
      inter_trial_interval_ms: {
        type: "number",
        default: 500,
        description: "Blank time between trials.",
      },
      number_of_trials: {
        type: "integer",
        default: 5,
        description: "Total number of letters presented.",
      },
      target_percentage: {
        type: "number",
        default: 0.3,
        description: "Percentage of trials that are matches.",
      },
    };

    const nBackTrialSchema: TrialSchema = {
      trial_index: { type: "integer", description: "Index of the trial." },
      presented_letter: { type: "string", description: "The letter shown." },
      n_level: { type: "integer", description: "The N level." },
      is_target: { type: "boolean", description: "Was this a match?" },
      response_correct: { type: "boolean", description: "Did the user respond correctly?" },
      // FIX: Change type to allow null values
      response_time_ms: { 
        type: ["number", "null"], 
        description: "Time taken to respond." 
      },
    };

    const options: GameOptions = {
      name: "N-Back",
      id: "nback",
      // FIX 1: Added required publishUuid
      publishUuid: "",
      version: "1.0.0",
      shortDescription: "2-Back Memory Task",
      longDescription: "Click the button if the current letter matches the one 2 steps ago.",
      width: 400,
      height: 800,
      trialSchema: nBackTrialSchema,
      parameters: defaultParameters,
      fonts: [
        {
          fontName: "roboto",
          url: "fonts/roboto/Roboto-Regular.ttf",
        },
      ],
    };

    super(options);
  }

  override async initialize() {
    await super.initialize();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const game = this;

    // --- 1. Game Logic / Sequence Generation ---
    interface TrialConfig {
      letter: string;
      isTarget: boolean;
    }

    const nLevel = game.getParameter<number>("n_level");
    const totalTrials = game.getParameter<number>("number_of_trials");
    const targetPct = game.getParameter<number>("target_percentage");
    const lettersPool = ["A", "B", "C", "D", "E", "H", "K", "L", "M", "O", "P", "R", "S", "T"];
    
    const trialConfigs: TrialConfig[] = [];

    for (let i = 0; i < totalTrials; i++) {
      let letter = "";
      let isTarget = false;

      // Logic to force targets based on N-level
      if (i >= nLevel && Math.random() < targetPct) {
          isTarget = true;
          letter = trialConfigs[i - nLevel].letter;
      } else {
          // Pick a random letter that is NOT a target
          do {
            letter = lettersPool[Math.floor(Math.random() * lettersPool.length)];
          } while (i >= nLevel && letter === trialConfigs[i - nLevel].letter);
      }
      trialConfigs.push({ letter, isTarget });
    }

    // --- 2. Scenes ---

    // Instructions
    const instructions = Instructions.create({
      instructionScenes: [
        {
          title: `${nLevel}-Back`,
          text: `Two circles will appear.\n\nThe TOP circle will show a letter for a short time.\n\nTap the BOTTOM circle if the current letter matches the letter from ${nLevel} steps ago.`,
          nextButtonText: "START",
          nextButtonBackgroundColor: WebColors.Green,
        },
      ],
    });
    game.addScenes(instructions);

    // Countdown
    const countdownScene = new CountdownScene({ milliseconds: 3000, text: "" });
    game.addScene(countdownScene);

    // Wait Scene (The "Preparation" Scene between trials)
    const waitScene = new Scene();
    game.addScene(waitScene);
    const getReadyLabel = new Label({
        text: "Get Ready",
        fontSize: 24,
        fontColor: WebColors.Black,
        position: { x: 200, y: 400 }, // Center
    });
    waitScene.addChild(getReadyLabel);  
    waitScene.onAppear(() => {
        // If we are done, jump straight to doneScene
        if (game.trialIndex >= totalTrials) {
            game.presentScene(doneScene);
            return;
        }

        // Otherwise, wait for the inter-trial interval, then go to presentation
        waitScene.run(
            Action.sequence([
                Action.wait({
                    duration: game.getParameter("inter_trial_interval_ms"),
                }),
                Action.custom({
                    callback: () => {
                        game.presentScene(presentationScene);
                    },
                }),
            ])
        );
    });

    // Main Presentation Scene
    const presentationScene = new Scene();
    game.addScene(presentationScene);

    presentationScene.onAppear(() => {
      const idx = game.trialIndex;
      // Safety check for end of trials
      if (idx >= trialConfigs.length) { 
        game.presentScene(doneScene);
        return;
      }

      const config = trialConfigs[idx];
      const stimDuration = game.getParameter<number>("stimulus_duration_ms");
      const trialDuration = game.getParameter<number>("trial_duration_ms");

      Timer.startNew("responseTime");

      // --- CIRCLE 1: The Stimulus (Top) ---
      const stimulusCircle = new Button({
        text: config.letter,
        fontSize: 40,
        fontColor: WebColors.Black,
        backgroundColor: WebColors.WhiteSmoke,
        size: { width: 120, height: 120 },
        cornerRadius: 60,
        position: { x: 200, y: 250 },
        isUserInteractionEnabled: false, 
      });
      presentationScene.addChild(stimulusCircle);

      // --- CIRCLE 2: The Response Button (Bottom) ---
      const responseButton = new Button({
        text: "MATCH",
        fontColor: WebColors.White,
        backgroundColor: WebColors.Blue,
        size: { width: 120, height: 120 },
        cornerRadius: 60,
        position: { x: 200, y: 550 },
        isUserInteractionEnabled: true,
      });
      presentationScene.addChild(responseButton);

      let responseMade = false;
      let hideTimer: any;
      let endTimer: any;

      const handleEndTrial = (responded: boolean) => {
        if (responseMade) return;
        responseMade = true;

        clearTimeout(hideTimer);
        clearTimeout(endTimer);

        Timer.stop("responseTime");
        const rt = Timer.elapsed("responseTime");
        Timer.remove("responseTime");

        // Determine correctness
        let isCorrect = false;
        if (config.isTarget) {
            isCorrect = responded; 
        } else {
            isCorrect = !responded;
        }

        game.addTrialData("trial_index", idx);
        game.addTrialData("presented_letter", config.letter);
        game.addTrialData("n_level", nLevel);
        game.addTrialData("is_target", config.isTarget);
        game.addTrialData("response_correct", isCorrect);
        game.addTrialData("response_time_ms", responded ? rt : null);

        presentationScene.removeAllChildren();
        game.trialComplete();

        // Loop back to the Wait Scene
        game.presentScene(waitScene);
      };

      // 1. TIMEOUT: Hide the stimulus letter after X ms
      hideTimer = setTimeout(() => {
        stimulusCircle.alpha = 0; 
      }, stimDuration);

      // 2. TIMEOUT: End trial after full duration
      endTimer = setTimeout(() => {
        handleEndTrial(false);
      }, trialDuration);

      // 3. INTERACTION: Handle user click
      responseButton.onTapDown(() => {
        responseButton.backgroundColor = WebColors.Green; // Visual feedback
        handleEndTrial(true);
      });
    });

    // Done Scene
    const doneScene = new Scene();
    game.addScene(doneScene);
    
    const doneText = new Label({ 
        text: "Task Complete", 
        position: { x: 200, y: 400 } 
    });
    doneScene.addChild(doneText);

    // AUTOMATION: Instead of a button, we run this when the scene appears
    doneScene.onAppear(() => {
        // Wait 1.5 seconds so they see "Task Complete", then finish
        setTimeout(() => {
            if (window.parent) {
                console.log("Sending NBACK_COMPLETE");
                window.parent.postMessage({ type: "NBACK_COMPLETE" }, "*");
            }
            game.end();
        }, 1500);
    });
  }
}

// --- Initialize and Run ---
const activity = new NBack();

const urlParams = new URLSearchParams(window.location.search);
const params: any = {};
urlParams.forEach((value, key) => {
  params[key] = value;
});
activity.setParameters(params);

const session = new Session({
  activities: [activity],
});
session.onActivityData((ev) => {
  const dataObj = ev.data as any;
  const trials = dataObj.trials; // The array of raw trial data
  const config = ev.activityConfiguration as any;
  if (trials && trials.length >= config.number_of_trials) {
    // Calculate simple accuracy for the parent wrapper
    const correctCount = trials.filter((t: any) => t.response_correct === true).length;
    const accuracy = (correctCount / trials.length) * 100;

    // Create a simplified list if you want, or just send 'trials' directly.
    // Here we map it to ensure numbers are rounded and clean.
    const simplifiedTrials = trials.map((t: any) => ({
      trial_index: t.trial_index,
      letter: t.presented_letter,
      is_target: t.is_target,
      correct: t.response_correct ? 1 : 0,
      rt: t.response_time_ms ? Math.round(t.response_time_ms) : null
    }));

    if (window.parent) {
      window.parent.postMessage({
          type: "NBACK_COMPLETE", // Unique ID for this game
          acc: accuracy.toFixed(2),
          details: JSON.stringify(simplifiedTrials) // The JSON requested
      }, "*");
      console.log(simplifiedTrials)
      console.log(accuracy)
    }
  }
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as unknown as any).m2c2kitSession = session;

session.initialize();