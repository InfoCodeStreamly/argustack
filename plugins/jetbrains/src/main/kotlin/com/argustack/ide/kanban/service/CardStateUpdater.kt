package com.argustack.ide.kanban.service

import com.argustack.ide.kanban.model.Card
import com.argustack.ide.terminal.model.ExecutionState
import java.time.Instant

/**
 * Applies single-field mutations to a card list by ID.
 * Each method returns a new list with the matching card updated.
 */
public class CardStateUpdater {

    public fun withColumn(cards: List<Card>, cardId: String, column: String): List<Card> =
        applyUpdate(cards, cardId) { it.copy(column = column) }

    public fun withSession(cards: List<Card>, cardId: String, sessionName: String): List<Card> =
        applyUpdate(cards, cardId) { it.copy(sessionName = sessionName) }

    public fun withJiraKey(cards: List<Card>, cardId: String, jiraKey: String): List<Card> =
        applyUpdate(cards, cardId) { it.copy(jiraKey = jiraKey) }

    public fun withEpic(cards: List<Card>, cardId: String, epic: String, newMdPath: String): List<Card> =
        applyUpdate(cards, cardId) { it.copy(epic = epic, mdPath = newMdPath) }

    public fun withExecutionState(cards: List<Card>, cardId: String, state: ExecutionState): List<Card> =
        applyUpdate(cards, cardId) { it.copy(executionState = state.name) }

    public fun withMdPath(cards: List<Card>, cardId: String, newPath: String): List<Card> =
        applyUpdate(cards, cardId) { it.copy(mdPath = newPath) }

    private fun applyUpdate(cards: List<Card>, cardId: String, transform: (Card) -> Card): List<Card> {
        val now = Instant.now().toString()
        return cards.map { card ->
            if (card.id == cardId) transform(card).copy(updatedAt = now) else card
        }
    }
}
