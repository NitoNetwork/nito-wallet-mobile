type ActionChange<Action> = (action: Action | null) => void;
type YieldBeforeTask = () => Promise<void>;

const noChange = () => undefined;
const noYield = async () => undefined;

export class ExclusiveActionGate<Action> {
  private current: Action | null = null;

  constructor(
    private readonly onChange: ActionChange<Action> = noChange,
    private readonly yieldBeforeTask: YieldBeforeTask = noYield,
  ) {}

  get active(): Action | null {
    return this.current;
  }

  async run(
    action: Action,
    task: () => Promise<void> | void,
  ): Promise<boolean> {
    if (this.current !== null) {
      return false;
    }

    this.current = action;
    this.onChange(action);
    await this.yieldBeforeTask();

    try {
      await task();
      return true;
    } finally {
      this.current = null;
      this.onChange(null);
    }
  }
}
