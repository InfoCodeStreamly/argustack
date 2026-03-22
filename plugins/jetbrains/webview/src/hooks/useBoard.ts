import { useState, useCallback, useEffect } from 'react';
import type { BoardState, BoardSettings, BridgeResponse, ExecutionState } from '../types.js';
import { useBridge } from './useBridge.js';

interface UseBoardResult {
  board: BoardState | null;
  runningCards: Map<string, ExecutionState>;
  moveCard: (cardId: string, targetColumn: string) => void;
  createCard: (title: string, epic: string) => void;
  deleteCard: (cardId: string) => void;
  runSkill: (cardId: string, skillName: string) => void;
  openFile: (cardId: string) => void;
  changeEpic: (cardId: string, targetEpic: string) => void;
  resumeSession: (cardId: string) => void;
  setWorkflow: (name: string | null) => void;
  reorderColumns: (columnNames: string[]) => void;
  updateSettings: (settings: BoardSettings) => void;
  createJiraIssue: (cardId: string) => void;
  createEpic: (name: string) => void;
  createWorkflow: (name: string, skills: string[]) => void;
  updateWorkflow: (name: string, newName: string, skills: string[]) => void;
  deleteWorkflow: (name: string) => void;
  filterEpic: (epicName: string | null) => void;
  updateDoneFilter: (value: number, unit: string) => void;
}

export function useBoard(): UseBoardResult {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [runningCards, setRunningCards] = useState<Map<string, ExecutionState>>(new Map());

  const handleResponse = useCallback((response: BridgeResponse) => {
    switch (response.type) {
      case 'boardStateUpdate':
        setBoard({
          cards: response.cards,
          columns: response.columns,
          epics: response.epics,
          workflows: response.workflows ?? [],
          settings: response.settings ?? { jiraProjectKey: null, doneFilterValue: 1, doneFilterUnit: 'days' },
          activeEpicFilter: response.activeEpicFilter,
          activeWorkflow: response.activeWorkflow ?? null,
          claudeAvailable: response.claudeAvailable,
          allSkills: response.allSkills ?? [],
          jiraConfigured: response.jiraConfigured ?? false,
        });
        break;
      case 'executionStateChanged':
        setRunningCards((prev) => {
          const next = new Map(prev);
          if (response.state === 'IDLE') {
            next.delete(response.cardId);
          } else {
            next.set(response.cardId, response.state);
          }
          return next;
        });
        break;
      case 'error':
        console.error('Bridge error:', response.message);
        break;
    }
  }, []);

  const { send } = useBridge(handleResponse);

  useEffect(() => {
    send({ type: 'requestBoardState' });
  }, [send]);

  const moveCard = useCallback((cardId: string, targetColumn: string) => {
    setBoard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === cardId ? { ...c, column: targetColumn } : c,
        ),
      };
    });
    send({ type: 'moveCard', cardId, targetColumn });
  }, [send]);

  const createCard = useCallback((title: string, epic: string) => {
    send({ type: 'createCard', title, epic });
  }, [send]);

  const deleteCard = useCallback((cardId: string) => {
    send({ type: 'deleteCard', cardId });
  }, [send]);

  const runSkill = useCallback((cardId: string, skillName: string) => {
    send({ type: 'runSkill', cardId, skillName });
  }, [send]);

  const openFile = useCallback((cardId: string) => {
    send({ type: 'openFile', cardId });
  }, [send]);

  const changeEpic = useCallback((cardId: string, targetEpic: string) => {
    send({ type: 'changeEpic', cardId, targetEpic });
  }, [send]);

  const resumeSession = useCallback((cardId: string) => {
    send({ type: 'resumeSession', cardId });
  }, [send]);

  const setWorkflow = useCallback((name: string | null) => {
    send({ type: 'setWorkflow', workflowName: name });
  }, [send]);

  const reorderColumns = useCallback((columnNames: string[]) => {
    send({ type: 'reorderColumns', columnNames });
  }, [send]);

  const updateSettings = useCallback((settings: BoardSettings) => {
    send({ type: 'updateSettings', jiraProjectKey: settings.jiraProjectKey });
  }, [send]);

  const updateDoneFilter = useCallback((value: number, unit: string) => {
    send({ type: 'updateSettings', doneFilterValue: value, doneFilterUnit: unit });
  }, [send]);

  const createJiraIssue = useCallback((cardId: string) => {
    send({ type: 'createJiraIssue', cardId });
  }, [send]);

  const createEpic = useCallback((name: string) => {
    send({ type: 'createEpic', name });
  }, [send]);

  const createWorkflow = useCallback((name: string, skills: string[]) => {
    send({ type: 'createWorkflow', name, skills });
  }, [send]);

  const updateWorkflow = useCallback((name: string, newName: string, skills: string[]) => {
    send({ type: 'updateWorkflow', name, newName, skills });
  }, [send]);

  const deleteWorkflow = useCallback((name: string) => {
    send({ type: 'deleteWorkflow', name });
  }, [send]);

  const filterEpic = useCallback((epicName: string | null) => {
    send({ type: 'filterEpic', epicName });
  }, [send]);

  return { board, runningCards, moveCard, createCard, deleteCard, runSkill, openFile, changeEpic, resumeSession, setWorkflow, reorderColumns, updateSettings, createJiraIssue, createEpic, createWorkflow, updateWorkflow, deleteWorkflow, filterEpic, updateDoneFilter };
}
