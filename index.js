"use strict";

function acquireLock(client, lockName, timeout, retryDelay, onLockAquired) {
	function retry() {
		acquireLock(client, lockName, timeout, retryDelay, onLockAquired);
	}

	var lockTimeoutValue = (Date.now() + timeout + 1);

	client.setnx(lockName, lockTimeoutValue, function(err, result) {
		if(err) return setTimeout(retry, retryDelay);

		if(result === 0) {
			// Lock couldn't be aquired. Check if the existing lock has timed out.

			client.get(lockName, function(err, existingLockTimestamp) {
				if(err) return setTimeout(retry, retryDelay);
				if(!existingLockTimestamp) {
					// Wait, the lock doesn't exist!
					// Someone must have called .del after we called .setnx but before .get.
					// https://github.com/errorception/redis-lock/pull/4
					return setTimeout(retry, retryDelay);
				}

				existingLockTimestamp = parseFloat(existingLockTimestamp);

				if(existingLockTimestamp > Date.now()) {
					// Lock looks valid so far. Wait some more time.
					return setTimeout(retry, retryDelay);
				}

				lockTimeoutValue = (Date.now() + timeout + 1)
				client.getset(lockName, lockTimeoutValue, function(err, result) {
					if(err) return setTimeout(retry, retryDelay);

					if(result == existingLockTimestamp) {
						onLockAquired(lockTimeoutValue);
					} else {
						setTimeout(retry, retryDelay);
					}
				});
			});
		} else {
			onLockAquired(lockTimeoutValue);
		}
	});
}

module.exports = function(client, retryDelay) {
	if(!(client && client.setnx)) {
		throw new Error("You must specify a client instance of http://github.com/mranney/node_redis");
	}

	retryDelay = retryDelay || 50;

	return function(lockName, timeout, taskToPerform) {
		if(!lockName) {
			throw new Error("You must specify a lock string. It is on the basis on this the lock is acquired.");
		}

		if(!taskToPerform) {
			taskToPerform = timeout;
			timeout = 5000;
		}

		lockName = "lock." + lockName;

		acquireLock(client, lockName, timeout, retryDelay, function(lockTimeoutValue) {
			taskToPerform(function(done) {
				if(lockTimeoutValue > Date.now()) {
					client.del(lockName, done);
				} else {
					done();
				}
			});
		});
	}
};
