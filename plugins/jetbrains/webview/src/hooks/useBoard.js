import { useState, useCallback, useEffect } from 'react';
import { useBridge } from './useBridge.js';
export function useBoard() {
    const [board, setBoard] = useState(null);
    const [runningCards, setRunningCards] = useState(new Map());
    const handleResponse = useCallback((response) => {
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
                    }
                    else {
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
    const moveCard = useCallback((cardId, targetColumn) => {
        setBoard((prev) => {
            if (!prev)
                return prev;
            return {
                ...prev,
                cards: prev.cards.map((c) => c.id === cardId ? { ...c, column: targetColumn } : c),
            };
        });
        send({ type: 'moveCard', cardId, targetColumn });
    }, [send]);
    const createCard = useCallback((title, epic) => {
        send({ type: 'createCard', title, epic });
    }, [send]);
    const deleteCard = useCallback((cardId) => {
        send({ type: 'deleteCard', cardId });
    }, [send]);
    const runSkill = useCallback((cardId, skillName) => {
        send({ type: 'runSkill', cardId, skillName });
    }, [send]);
    const openFile = useCallback((cardId) => {
        send({ type: 'openFile', cardId });
    }, [send]);
    const changeEpic = useCallback((cardId, targetEpic) => {
        send({ type: 'changeEpic', cardId, targetEpic });
    }, [send]);
    const resumeSession = useCallback((cardId) => {
        send({ type: 'resumeSession', cardId });
    }, [send]);
    const setWorkflow = useCallback((name) => {
        send({ type: 'setWorkflow', workflowName: name });
    }, [send]);
    const reorderColumns = useCallback((columnNames) => {
        send({ type: 'reorderColumns', columnNames });
    }, [send]);
    const updateSettings = useCallback((settings) => {
        send({ type: 'updateSettings', jiraProjectKey: settings.jiraProjectKey });
    }, [send]);
    const updateDoneFilter = useCallback((value, unit) => {
        send({ type: 'updateSettings', doneFilterValue: value, doneFilterUnit: unit });
    }, [send]);
    const createJiraIssue = useCallback((cardId) => {
        send({ type: 'createJiraIssue', cardId });
    }, [send]);
    const createEpic = useCallback((name) => {
        send({ type: 'createEpic', name });
    }, [send]);
    const createWorkflow = useCallback((name, skills) => {
        send({ type: 'createWorkflow', name, skills });
    }, [send]);
    const updateWorkflow = useCallback((name, newName, skills) => {
        send({ type: 'updateWorkflow', name, newName, skills });
    }, [send]);
    const deleteWorkflow = useCallback((name) => {
        send({ type: 'deleteWorkflow', name });
    }, [send]);
    const filterEpic = useCallback((epicName) => {
        send({ type: 'filterEpic', epicName });
    }, [send]);
    return { board, runningCards, moveCard, createCard, deleteCard, runSkill, openFile, changeEpic, resumeSession, setWorkflow, reorderColumns, updateSettings, createJiraIssue, createEpic, createWorkflow, updateWorkflow, deleteWorkflow, filterEpic, updateDoneFilter };
}
