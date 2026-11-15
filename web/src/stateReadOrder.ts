export interface StateReadTicket {
  readonly accountId: string | null;
  readonly generation: number;
}

/** Orders in-memory state reads against account changes and acknowledged writes. */
export class StateReadOrder {
  private accountId: string | null = null;
  private generation = 0;

  startAccountLoad(): StateReadTicket {
    this.accountId = null;
    return { accountId: null, generation: ++this.generation };
  }

  bindAccount(ticket: StateReadTicket, accountId: string): StateReadTicket | null {
    if (!this.isCurrent(ticket) || ticket.accountId !== null) return null;
    this.accountId = accountId;
    return { ...ticket, accountId };
  }

  startRead(accountId: string): StateReadTicket | null {
    if (this.accountId !== accountId) return null;
    return { accountId, generation: ++this.generation };
  }

  /** The ACK is newer than every GET already in flight, even if the next GET fails. */
  acknowledge(accountId: string): boolean {
    if (this.accountId !== accountId) return false;
    ++this.generation;
    return true;
  }

  isCurrent(ticket: StateReadTicket): boolean {
    return ticket.accountId === this.accountId && ticket.generation === this.generation;
  }

  clearAccount(accountId: string): boolean {
    if (this.accountId !== accountId) return false;
    this.startAccountLoad();
    return true;
  }
}
